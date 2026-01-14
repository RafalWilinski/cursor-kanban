// IMPORTANT:
// Cursor's public API does not allow browser CORS from arbitrary origins.
// In production we call our own same-origin proxy at `/api/cursor/*` (Vercel serverless),
// which forwards requests to https://api.cursor.com.
const API_BASE = '/api/cursor';
const API_KEY_STORAGE_KEY = 'cursor_api_key';
const REPOS_CACHE_KEY = 'cursor_repos_cache';
const REPOS_CACHE_EXPIRY_KEY = 'cursor_repos_cache_expiry';
const REPOS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Types based on Cursor Cloud Agents API
export interface AgentSource {
  repository: string;
  ref: string;
}

export interface AgentTarget {
  branchName?: string;
  url?: string;
  prUrl?: string;
  autoCreatePr?: boolean;
  openAsCursorGithubApp?: boolean;
  skipReviewerRequest?: boolean;
}

// Cursor API returns these statuses (DRAFT is local-only for drafts)
export type AgentStatus = 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'DRAFT';

// PR status fetched from GitHub API
export interface PrStatus {
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  checksStatus: 'pending' | 'success' | 'failure' | 'unknown';
  hasApproval: boolean;
  reviewDecision: string | null;
}

// Cache for PR statuses
const PR_STATUS_CACHE: Map<string, { status: PrStatus; fetchedAt: number }> = new Map();
const PR_STATUS_CACHE_TTL = 60 * 1000; // 1 minute

// Parse PR URL to extract owner, repo, and PR number
export function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  try {
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (match) {
      return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
    }
  } catch {
    // Invalid URL
  }
  return null;
}

// Fetch PR status from GitHub API (unauthenticated, rate-limited)
export async function fetchPrStatus(prUrl: string): Promise<PrStatus | null> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return null;

  // Check cache first
  const cached = PR_STATUS_CACHE.get(prUrl);
  if (cached && Date.now() - cached.fetchedAt < PR_STATUS_CACHE_TTL) {
    return cached.status;
  }

  try {
    const { owner, repo, number } = parsed;
    
    // Fetch PR details
    const prResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'cursor-kanban',
        },
      }
    );

    if (!prResponse.ok) {
      console.warn(`Failed to fetch PR status for ${prUrl}: ${prResponse.status}`);
      return null;
    }

    const prData = await prResponse.json();

    // Determine merged state
    const state: 'open' | 'closed' | 'merged' = prData.merged
      ? 'merged'
      : prData.state === 'closed'
      ? 'closed'
      : 'open';

    // Determine checks status from the head SHA commit status
    let checksStatus: 'pending' | 'success' | 'failure' | 'unknown' = 'unknown';
    
    try {
      // Try to get combined status
      const statusResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${prData.head.sha}/status`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'cursor-kanban',
          },
        }
      );
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        if (statusData.state === 'success') {
          checksStatus = 'success';
        } else if (statusData.state === 'failure' || statusData.state === 'error') {
          checksStatus = 'failure';
        } else if (statusData.state === 'pending') {
          checksStatus = 'pending';
        }
      }
      
      // Also check GitHub Actions check runs
      const checksResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${prData.head.sha}/check-runs`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'cursor-kanban',
          },
        }
      );
      
      if (checksResponse.ok) {
        const checksData = await checksResponse.json();
        const checkRuns = checksData.check_runs || [];
        
        if (checkRuns.length > 0) {
          const hasFailure = checkRuns.some((run: { conclusion: string }) => 
            run.conclusion === 'failure' || run.conclusion === 'cancelled' || run.conclusion === 'timed_out'
          );
          const allSuccess = checkRuns.every((run: { conclusion: string; status: string }) => 
            run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral'
          );
          const hasPending = checkRuns.some((run: { status: string }) => 
            run.status === 'queued' || run.status === 'in_progress'
          );
          
          if (hasFailure) {
            checksStatus = 'failure';
          } else if (hasPending) {
            checksStatus = 'pending';
          } else if (allSuccess) {
            checksStatus = 'success';
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch check status:', e);
    }

    // Determine approval status from review decision
    const hasApproval = prData.mergeable_state === 'clean' || 
                       prData.review_decision === 'APPROVED';

    const status: PrStatus = {
      state,
      isDraft: prData.draft || false,
      mergeable: prData.mergeable,
      mergeableState: prData.mergeable_state,
      checksStatus,
      hasApproval,
      reviewDecision: prData.review_decision || null,
    };

    // Cache the result
    PR_STATUS_CACHE.set(prUrl, { status, fetchedAt: Date.now() });

    return status;
  } catch (error) {
    console.error(`Error fetching PR status for ${prUrl}:`, error);
    return null;
  }
}

// Batch fetch PR statuses for multiple agents
export async function fetchPrStatusesForAgents(agents: Agent[]): Promise<Map<string, PrStatus>> {
  const results = new Map<string, PrStatus>();
  
  // Only fetch for agents with PR URLs
  const agentsWithPrs = agents.filter(a => a.target?.prUrl);
  
  // Fetch in parallel with a small concurrency limit to avoid rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < agentsWithPrs.length; i += BATCH_SIZE) {
    const batch = agentsWithPrs.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (agent) => {
      const prUrl = agent.target?.prUrl;
      if (prUrl) {
        const status = await fetchPrStatus(prUrl);
        if (status) {
          results.set(agent.id, status);
        }
      }
    });
    await Promise.all(promises);
  }
  
  return results;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  source: AgentSource;
  target?: AgentTarget;
  summary?: string;
  createdAt: string;
  // Local fields for drafts
  isDraft?: boolean;
  prompt?: string;
  model?: string;
}

export interface ConversationMessage {
  id: string;
  type: 'user_message' | 'assistant_message';
  text: string;
}

export interface Conversation {
  id: string;
  messages: ConversationMessage[];
}

export interface Repository {
  owner: string;
  name: string;
  repository: string;
}

export interface ApiKeyInfo {
  apiKeyName: string;
  createdAt: string;
  userEmail: string;
}

export interface ListAgentsResponse {
  agents: Agent[];
  nextCursor?: string;
}

// API Key Management
export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

// Helper for making authenticated requests
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key not set');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Basic ${btoa(apiKey + ':')}`);
  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// API Methods

export async function testConnection(): Promise<ApiKeyInfo> {
  return apiRequest<ApiKeyInfo>('/v0/me');
}

export async function listAgents(
  limit: number = 100,
  cursor?: string
): Promise<ListAgentsResponse> {
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  if (cursor) {
    params.set('cursor', cursor);
  }
  return apiRequest<ListAgentsResponse>(`/v0/agents?${params.toString()}`);
}

export async function getAllAgents(): Promise<Agent[]> {
  const allAgents: Agent[] = [];
  let cursor: string | undefined;

  do {
    const response = await listAgents(100, cursor);
    allAgents.push(...response.agents);
    cursor = response.nextCursor;
  } while (cursor);

  return allAgents;
}

export async function getAgent(id: string): Promise<Agent> {
  return apiRequest<Agent>(`/v0/agents/${id}`);
}

export async function getConversation(id: string): Promise<Conversation> {
  return apiRequest<Conversation>(`/v0/agents/${id}/conversation`);
}

export interface CreateAgentParams {
  repository: string;
  ref?: string;
  prompt: string;
  model?: string;
  autoCreatePr?: boolean;
}

export async function createAgent(params: CreateAgentParams): Promise<Agent> {
  const body: Record<string, unknown> = {
    source: {
      repository: params.repository,
      ref: params.ref || 'main',
    },
    prompt: {
      text: params.prompt,
    },
  };

  if (params.model) {
    body.model = params.model;
  }

  if (params.autoCreatePr !== undefined) {
    body.target = {
      autoCreatePr: params.autoCreatePr,
    };
  }

  return apiRequest<Agent>('/v0/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface FollowupParams {
  text: string;
  images?: Array<{
    data: string;
    dimension: { width: number; height: number };
  }>;
}

export async function addFollowup(
  id: string,
  prompt: FollowupParams
): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/v0/agents/${id}/followup`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

export async function stopAgent(id: string): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/v0/agents/${id}/stop`, {
    method: 'POST',
  });
}

export async function deleteAgent(id: string): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/v0/agents/${id}`, {
    method: 'DELETE',
  });
}

export async function listModels(): Promise<{ models: string[] }> {
  return apiRequest<{ models: string[] }>('/v0/models');
}

export async function listRepositories(
  forceRefresh = false
): Promise<{ repositories: Repository[] }> {
  // Check cache first (due to strict rate limits)
  if (!forceRefresh) {
    const cachedData = localStorage.getItem(REPOS_CACHE_KEY);
    const cacheExpiry = localStorage.getItem(REPOS_CACHE_EXPIRY_KEY);

    if (cachedData && cacheExpiry) {
      const expiryTime = parseInt(cacheExpiry, 10);
      if (Date.now() < expiryTime) {
        return JSON.parse(cachedData);
      }
    }
  }

  const data = await apiRequest<{ repositories: Repository[] }>(
    '/v0/repositories'
  );

  // Cache the result
  localStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(
    REPOS_CACHE_EXPIRY_KEY,
    (Date.now() + REPOS_CACHE_DURATION).toString()
  );

  return data;
}

// Draft management (stored locally)
const DRAFTS_STORAGE_KEY = 'cursor_agent_drafts';

// Last picked repository (stored locally)
const LAST_REPOSITORY_KEY = 'cursor_last_repository';

export function getLastRepository(): string | null {
  return localStorage.getItem(LAST_REPOSITORY_KEY);
}

export function setLastRepository(repository: string): void {
  localStorage.setItem(LAST_REPOSITORY_KEY, repository);
}

export interface DraftAgent {
  id: string;
  name: string;
  repository: string;
  ref: string;
  prompt: string;
  model?: string;
  createdAt: string;
}

export function getDrafts(): DraftAgent[] {
  const data = localStorage.getItem(DRAFTS_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveDraft(draft: Omit<DraftAgent, 'id' | 'createdAt'>): DraftAgent {
  const drafts = getDrafts();
  const newDraft: DraftAgent = {
    ...draft,
    id: `draft_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  drafts.push(newDraft);
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  return newDraft;
}

export function deleteDraft(id: string): void {
  const drafts = getDrafts().filter((d) => d.id !== id);
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

export function getDraft(id: string): DraftAgent | undefined {
  return getDrafts().find((d) => d.id === id);
}
