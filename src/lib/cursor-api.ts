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
  // PR status fields
  checksStatus?: 'pending' | 'success' | 'failure';
  hasApproval?: boolean;
  isMerged?: boolean;
  isClosed?: boolean;
  hasConflict?: boolean;
}

export type AgentStatus = 'RUNNING' | 'FINISHED' | 'STOPPED' | 'FAILED' | 'DRAFT';

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
