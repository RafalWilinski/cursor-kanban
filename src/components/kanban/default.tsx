'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from '@/components/ui/kanban';
import {
  GripVertical,
  Plus,
  GitBranch,
  ExternalLink,
  Loader2,
  Send,
  Trash2,
  Square,
  Play,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  GitPullRequestDraft,
} from 'lucide-react';
import {
  type Agent,
  type AgentStatus,
  type Conversation,
  type ConversationMessage,
  type Repository,
  type DraftAgent,
  type PrStatus,
  getAllAgents,
  getConversation,
  createAgent,
  addFollowup,
  stopAgent,
  deleteAgent,
  listModels,
  listRepositories,
  getDrafts,
  saveDraft,
  deleteDraft,
  getLastRepository,
  setLastRepository,
  fetchPrStatusesForAgents,
} from '@/lib/cursor-api';

// Column configuration
const COLUMNS: Record<string, { title: string; description: string }> = {
  backlog: { title: 'Backlog', description: 'Drafts ready to launch' },
  creating: { title: 'Starting', description: 'Agents being initialized' },
  running: { title: 'In Progress', description: 'Agents currently working' },
  needs_input: { title: 'Needs Input', description: 'Waiting for follow-up or no PR' },
  failed: { title: 'Failed', description: 'Agents with errors' },
  draft_pr: { title: 'Draft PR', description: 'PRs marked as draft' },
  checks_failing: { title: 'Checks Failing', description: 'PRs with failing CI' },
  has_conflict: { title: 'Has Conflict', description: 'PRs with merge conflicts' },
  checks_pending: { title: 'Checks Running', description: 'CI checks in progress' },
  awaiting_review: { title: 'Awaiting Review', description: 'Needs approval' },
  approved: { title: 'Approved', description: 'Ready to merge' },
  merged: { title: 'Merged/Closed', description: 'Completed PRs' },
};

const KANBAN_COLUMN_ORDER_STORAGE_KEY = 'cursor_cloud_agents_kanban_column_order';

function getSavedColumnOrder(): string[] | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(KANBAN_COLUMN_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function saveColumnOrder(order: string[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KANBAN_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore persistence failures (e.g. private mode / full quota)
  }
}

function normalizeColumnOrder(order: string[], allColumns: string[]): string[] {
  const allowed = new Set(allColumns);
  const seen = new Set<string>();

  const normalized: string[] = [];
  for (const key of order) {
    if (allowed.has(key) && !seen.has(key)) {
      normalized.push(key);
      seen.add(key);
    }
  }

  for (const key of allColumns) {
    if (!seen.has(key)) {
      normalized.push(key);
      seen.add(key);
    }
  }

  return normalized;
}

// Map API status and PR info to column
function getColumnForStatus(status: AgentStatus, prUrl?: string, prStatus?: PrStatus | null): string {
  // Handle local drafts
  if (status === 'DRAFT') {
    return 'backlog';
  }

  // Handle creating/initializing agents
  if (status === 'CREATING') {
    return 'creating';
  }

  // Handle running agents
  if (status === 'RUNNING') {
    return 'running';
  }

  // Handle error/expired agents - treat as failed
  // (Expired agents are filtered at the API layer and should not appear here.)
  if (status === 'ERROR' || status === 'EXPIRED') {
    return 'failed';
  }

  // For FINISHED agents, categorize based on PR status
  if (status === 'FINISHED') {
    // No PR URL - agent finished but didn't create a PR, needs input
    if (!prUrl) {
      return 'needs_input';
    }

    // No PR status fetched yet - show in awaiting review as fallback
    if (!prStatus) {
      return 'awaiting_review';
    }

    // PR is merged
    if (prStatus.state === 'merged') {
      return 'merged';
    }

    // PR is closed (but not merged)
    if (prStatus.state === 'closed') {
      return 'merged';
    }

    // PR is a draft
    if (prStatus.isDraft) {
      return 'draft_pr';
    }

    // PR has merge conflicts
    if (prStatus.mergeable === false || prStatus.mergeableState === 'dirty') {
      return 'has_conflict';
    }

    // PR has failing checks
    if (prStatus.checksStatus === 'failure') {
      return 'checks_failing';
    }

    // PR has pending checks
    if (prStatus.checksStatus === 'pending') {
      return 'checks_pending';
    }

    // PR is approved
    if (prStatus.hasApproval || prStatus.reviewDecision === 'APPROVED') {
      return 'approved';
    }

    // Default: awaiting review
    return 'awaiting_review';
  }

  // Fallback
  return 'needs_input';
}

// Status badge colors
function getStatusBadge(status: AgentStatus) {
  switch (status) {
    case 'CREATING':
      return { variant: 'secondary' as const, icon: <Loader2 className="size-3 animate-spin" /> };
    case 'RUNNING':
      return { variant: 'primary' as const, icon: <Loader2 className="size-3 animate-spin" /> };
    case 'FINISHED':
      return { variant: 'success' as const, icon: <CheckCircle2 className="size-3" /> };
    case 'ERROR':
      return { variant: 'destructive' as const, icon: <XCircle className="size-3" /> };
    case 'EXPIRED':
      return { variant: 'warning' as const, icon: <Clock className="size-3" /> };
    case 'DRAFT':
      return { variant: 'secondary' as const, icon: <MessageSquare className="size-3" /> };
    default:
      return { variant: 'secondary' as const, icon: null };
  }
}

// Agent card component
interface AgentCardProps {
  agent: Agent | DraftAgent;
  isDraft?: boolean;
  prStatus?: PrStatus | null;
  onClick?: () => void;
}

function AgentCard({ agent, isDraft, prStatus, onClick }: AgentCardProps) {
  const status = isDraft ? 'DRAFT' : (agent as Agent).status;
  const { variant, icon } = getStatusBadge(status);
  const source = isDraft
    ? { repository: (agent as DraftAgent).repository, ref: (agent as DraftAgent).ref }
    : (agent as Agent).source;

  const cardContent = (
    <div
      className="rounded-md border bg-card p-3 shadow-xs cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
      onClick={onClick}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 font-medium text-sm">{agent.name}</span>
          <Badge variant={variant} appearance="outline" className="h-5 rounded-sm px-1.5 text-[11px] shrink-0 flex items-center gap-1">
            {icon}
            {status}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <GitBranch className="size-3" />
          <span className="line-clamp-1">{source.repository.split('/').slice(-2).join('/')}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{source.ref}</span>
        </div>
        {!isDraft && (agent as Agent).summary && (
          <p className="text-muted-foreground text-xs line-clamp-2">{(agent as Agent).summary}</p>
        )}
        {isDraft && (agent as DraftAgent).prompt && (
          <p className="text-muted-foreground text-xs line-clamp-2">{(agent as DraftAgent).prompt}</p>
        )}
        {!isDraft && (agent as Agent).target?.prUrl && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <a
              href={(agent as Agent).target!.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" />
              <span>PR</span>
            </a>
            {/* PR State indicators based on fetched GitHub status */}
            {prStatus && (
              <>
                {/* Merged indicator */}
                {prStatus.state === 'merged' && (
                  <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                    <CheckCircle2 className="size-3" />
                    <span>Merged</span>
                  </span>
                )}
                {/* Closed indicator */}
                {prStatus.state === 'closed' && (
                  <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                    <XCircle className="size-3" />
                    <span>Closed</span>
                  </span>
                )}
                {/* Draft indicator */}
                {prStatus.isDraft && prStatus.state === 'open' && (
                  <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <GitPullRequestDraft className="size-3" />
                    <span>Draft</span>
                  </span>
                )}
                {/* Conflict indicator */}
                {(prStatus.mergeable === false || prStatus.mergeableState === 'dirty') && prStatus.state === 'open' && (
                  <span className="flex items-center gap-1 text-orange-600 dark:text-orange-500">
                    <AlertCircle className="size-3" />
                    <span>Conflict</span>
                  </span>
                )}
                {/* Check status indicator */}
                {prStatus.state === 'open' && prStatus.checksStatus === 'failure' && (
                  <span className="flex items-center gap-1 text-destructive">
                    <ShieldAlert className="size-3" />
                    <span>Failing</span>
                  </span>
                )}
                {prStatus.state === 'open' && prStatus.checksStatus === 'success' && (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                    <ShieldCheck className="size-3" />
                    <span>Passing</span>
                  </span>
                )}
                {prStatus.state === 'open' && prStatus.checksStatus === 'pending' && (
                  <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
                    <Loader2 className="size-3 animate-spin" />
                    <span>Running</span>
                  </span>
                )}
                {/* Approval indicator */}
                {prStatus.state === 'open' && prStatus.hasApproval && (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                    <CheckCircle2 className="size-3" />
                    <span>LGTM</span>
                  </span>
                )}
              </>
            )}
          </div>
        )}
        <time className="text-[10px] text-muted-foreground/60 tabular-nums">
          {new Date(agent.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
    </div>
  );

  return (
    <KanbanItem value={agent.id} disabled>
      <KanbanItemHandle>{cardContent}</KanbanItemHandle>
    </KanbanItem>
  );
}

// Column component
interface AgentColumnProps {
  columnKey: string;
  agents: (Agent | DraftAgent)[];
  drafts?: DraftAgent[];
  prStatuses: Map<string, PrStatus>;
  onAgentClick: (agent: Agent | DraftAgent, isDraft: boolean) => void;
  onAddClick?: () => void;
}

function AgentColumn({ columnKey, agents, drafts = [], prStatuses, onAgentClick, onAddClick }: AgentColumnProps) {
  const config = COLUMNS[columnKey];
  const items = columnKey === 'backlog' ? drafts : agents;

  return (
    <KanbanColumn value={columnKey} className="rounded-md border bg-card p-2.5 shadow-xs min-w-[280px] w-[280px] flex-shrink-0 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{config.title}</span>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          {columnKey === 'backlog' && (
            <Button variant="ghost" size="sm" mode="icon" onClick={onAddClick} className="h-7 w-7">
              <Plus className="size-4" />
            </Button>
          )}
          <KanbanColumnHandle asChild>
            <Button variant="dim" size="sm" mode="icon" className="h-7 w-7">
              <GripVertical className="size-4" />
            </Button>
          </KanbanColumnHandle>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <KanbanColumnContent value={columnKey} className="flex flex-col gap-2 p-0.5 pr-2">
          {items.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isDraft={columnKey === 'backlog'}
              prStatus={prStatuses.get(agent.id)}
              onClick={() => onAgentClick(agent, columnKey === 'backlog')}
            />
          ))}
        </KanbanColumnContent>
      </ScrollArea>
    </KanbanColumn>
  );
}

// Conversation message component
function ConversationMessageItem({ message }: { message: ConversationMessage }) {
  const isUser = message.type === 'user_message';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

// Main Kanban component
interface CloudAgentsKanbanProps {
  apiKeySet: boolean;
  onOpenSettings: () => void;
}

export default function CloudAgentsKanban({ apiKeySet, onOpenSettings }: CloudAgentsKanbanProps) {
  // State
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [drafts, setDrafts] = React.useState<DraftAgent[]>([]);
  const [prStatuses, setPrStatuses] = React.useState<Map<string, PrStatus>>(new Map());
  const [isLoading, setIsLoading] = React.useState(false);
  const [isFetchingPrStatus, setIsFetchingPrStatus] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);

  // Drawer state
  const [selectedAgent, setSelectedAgent] = React.useState<Agent | DraftAgent | null>(null);
  const [selectedIsDraft, setSelectedIsDraft] = React.useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [conversation, setConversation] = React.useState<Conversation | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = React.useState(false);
  const [followupText, setFollowupText] = React.useState('');
  const [isSendingFollowup, setIsSendingFollowup] = React.useState(false);

  // Create form state
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [repositories, setRepositories] = React.useState<Repository[]>([]);
  const [models, setModels] = React.useState<string[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = React.useState(false);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({
    name: '',
    repository: '',
    customRepo: '',
    ref: 'main',
    prompt: '',
    model: '',
  });
  const [isCreating, setIsCreating] = React.useState(false);

  // Column order (persisted locally)
  const allColumnKeys = React.useMemo(() => Object.keys(COLUMNS), []);
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() => {
    const saved = getSavedColumnOrder();
    return normalizeColumnOrder(saved ?? allColumnKeys, allColumnKeys);
  });

  React.useEffect(() => {
    // Keep localStorage in sync with any changes (including new columns after deploy)
    const normalized = normalizeColumnOrder(columnOrder, allColumnKeys);
    if (normalized.join('|') !== columnOrder.join('|')) {
      setColumnOrder(normalized);
      return;
    }
    saveColumnOrder(normalized);
  }, [allColumnKeys, columnOrder]);

  // Load agents from API
  const loadAgents = React.useCallback(async () => {
    if (!apiKeySet) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedAgents = await getAllAgents();
      setAgents(fetchedAgents);
      setLastRefresh(new Date());

      // Fetch PR statuses for agents with PRs (in background)
      setIsFetchingPrStatus(true);
      fetchPrStatusesForAgents(fetchedAgents)
        .then((statuses) => {
          setPrStatuses(statuses);
        })
        .catch((err) => {
          console.warn('Failed to fetch PR statuses:', err);
        })
        .finally(() => {
          setIsFetchingPrStatus(false);
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  }, [apiKeySet]);

  // Load drafts from localStorage
  const loadDrafts = React.useCallback(() => {
    setDrafts(getDrafts());
  }, []);

  // Initial load
  React.useEffect(() => {
    if (apiKeySet) {
      loadAgents();
      loadDrafts();
    }
  }, [apiKeySet, loadAgents, loadDrafts]);

  // Auto-polling every 30 seconds (pause when drawer is open)
  // Rate limit is 30 requests/minute, so 30s interval keeps us well under
  React.useEffect(() => {
    if (!apiKeySet || isDrawerOpen) return;

    const interval = setInterval(() => {
      loadAgents();
    }, 30000);

    return () => clearInterval(interval);
  }, [apiKeySet, isDrawerOpen, loadAgents]);

  // Group agents by column
  const columns = React.useMemo(() => {
    const result: Record<string, Agent[]> = {
      backlog: [],
      creating: [],
      running: [],
      needs_input: [],
      failed: [],
      draft_pr: [],
      checks_failing: [],
      has_conflict: [],
      checks_pending: [],
      awaiting_review: [],
      approved: [],
      merged: [],
    };

    agents.forEach((agent) => {
      const prUrl = agent.target?.prUrl;
      const prStatus = prStatuses.get(agent.id);
      const column = getColumnForStatus(agent.status, prUrl, prStatus);
      if (result[column]) {
        result[column].push(agent);
      }
    });

    return result;
  }, [agents, prStatuses]);

  // Apply persisted order to the derived columns map (object insertion order drives DnD-kit column order)
  const orderedColumns = React.useMemo(() => {
    const normalized = normalizeColumnOrder(columnOrder, allColumnKeys);
    const ordered: Record<string, Agent[]> = {};
    for (const key of normalized) {
      ordered[key] = columns[key] ?? [];
    }
    return ordered;
  }, [allColumnKeys, columnOrder, columns]);

  // Handle agent click
  const handleAgentClick = async (agent: Agent | DraftAgent, isDraft: boolean) => {
    setSelectedAgent(agent);
    setSelectedIsDraft(isDraft);
    setIsDrawerOpen(true);
    setConversation(null);
    setFollowupText('');

    if (!isDraft) {
      setIsLoadingConversation(true);
      try {
        const convo = await getConversation(agent.id);
        setConversation(convo);
      } catch (err) {
        console.error('Failed to load conversation:', err);
      } finally {
        setIsLoadingConversation(false);
      }
    }
  };

  // Handle send follow-up
  const handleSendFollowup = async () => {
    if (!selectedAgent || selectedIsDraft || !followupText.trim()) return;

    setIsSendingFollowup(true);
    try {
      await addFollowup(selectedAgent.id, { text: followupText.trim() });
      setFollowupText('');
      // Reload conversation
      const convo = await getConversation(selectedAgent.id);
      setConversation(convo);
      // Refresh agents list
      await loadAgents();
    } catch (err) {
      console.error('Failed to send follow-up:', err);
    } finally {
      setIsSendingFollowup(false);
    }
  };

  // Handle stop agent
  const handleStopAgent = async () => {
    if (!selectedAgent || selectedIsDraft) return;

    try {
      await stopAgent(selectedAgent.id);
      await loadAgents();
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  // Handle delete agent
  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;

    try {
      if (selectedIsDraft) {
        deleteDraft(selectedAgent.id);
        loadDrafts();
      } else {
        await deleteAgent(selectedAgent.id);
        await loadAgents();
      }
      setIsDrawerOpen(false);
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  // Handle launch draft
  const handleLaunchDraft = async () => {
    if (!selectedAgent || !selectedIsDraft) return;

    const draft = selectedAgent as DraftAgent;
    setIsCreating(true);

    try {
      await createAgent({
        repository: draft.repository,
        ref: draft.ref,
        prompt: draft.prompt,
        model: draft.model,
      });
      deleteDraft(draft.id);
      loadDrafts();
      await loadAgents();
      setIsDrawerOpen(false);
    } catch (err) {
      console.error('Failed to launch agent:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // Open create form
  const handleOpenCreate = async () => {
    setIsCreateOpen(true);
    const lastRepo = getLastRepository();
    
    // Load repositories first to determine if lastRepo is from dropdown or custom
    setIsLoadingRepos(true);
    setIsLoadingModels(true);

    let reposList: Repository[] = [];
    try {
      const reposData = await listRepositories();
      reposList = reposData.repositories;
      setRepositories(reposList);
    } catch (err) {
      console.error('Failed to load repositories:', err);
    } finally {
      setIsLoadingRepos(false);
    }
    
    // Check if lastRepo is in the dropdown list or a custom URL
    const isInDropdown = lastRepo && reposList.some(r => r.repository === lastRepo);
    setCreateForm({
      name: '',
      repository: isInDropdown ? lastRepo : '',
      customRepo: lastRepo && !isInDropdown ? lastRepo : '',
      ref: 'main',
      prompt: '',
      model: '',
    });

    try {
      const modelsData = await listModels();
      setModels(modelsData.models);
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Handle create/save draft
  const handleCreate = async (asDraft: boolean) => {
    const repository = createForm.customRepo || createForm.repository;
    if (!repository || !createForm.prompt.trim()) return;

    if (asDraft) {
      saveDraft({
        name: createForm.name || createForm.prompt.slice(0, 50),
        repository,
        ref: createForm.ref,
        prompt: createForm.prompt,
        model: createForm.model || undefined,
      });
      loadDrafts();
      setIsCreateOpen(false);
    } else {
      setIsCreating(true);
      try {
        await createAgent({
          repository,
          ref: createForm.ref,
          prompt: createForm.prompt,
          model: createForm.model || undefined,
        });
        await loadAgents();
        setIsCreateOpen(false);
      } catch (err) {
        console.error('Failed to create agent:', err);
      } finally {
        setIsCreating(false);
      }
    }
  };

  // Render empty state
  if (!apiKeySet) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="size-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">API Key Required</h3>
        <p className="text-muted-foreground mb-4">
          Connect your Cursor account to manage Cloud Agents
        </p>
        <Button onClick={onOpenSettings}>Connect API Key</Button>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {(isLoading || isFetchingPrStatus) && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">
                Last updated: {lastRefresh.toLocaleTimeString()}
                {isFetchingPrStatus && ' (fetching PR statuses...)'}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadAgents} disabled={isLoading}>
            <RefreshCw className={`size-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2 flex-shrink-0">
            <XCircle className="size-4" />
            {error}
          </div>
        )}

        {/* Kanban Board */}
        <Kanban
          value={orderedColumns}
          onValueChange={(next) => {
            // Only persist column order; items are read-only (derived from API status)
            const nextOrder = normalizeColumnOrder(Object.keys(next), allColumnKeys);
            setColumnOrder(nextOrder);
          }}
          getItemValue={(item) => item.id}
          className="flex-1 min-h-0"
        >
          <KanbanBoard className="flex gap-4 overflow-auto h-full pb-4">
            {columnOrder.map((columnKey) => (
              <AgentColumn
                key={columnKey}
                columnKey={columnKey}
                agents={columns[columnKey] || []}
                drafts={columnKey === 'backlog' ? drafts : []}
                prStatuses={prStatuses}
                onAgentClick={handleAgentClick}
                onAddClick={columnKey === 'backlog' ? handleOpenCreate : undefined}
              />
            ))}
          </KanbanBoard>
          <KanbanOverlay>
            <div className="rounded-md bg-muted/60 size-full" />
          </KanbanOverlay>
        </Kanban>
      </div>

      {/* Agent Detail Drawer */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          <SheetHeader>
            <SheetTitle>{selectedAgent?.name || 'Agent Details'}</SheetTitle>
            <SheetDescription>
              {selectedIsDraft ? 'Draft agent - ready to launch' : 'View conversation and send follow-ups'}
            </SheetDescription>
          </SheetHeader>

          {selectedAgent && (
            <div className="flex-1 flex flex-col gap-4 overflow-hidden px-4">
              {/* Agent Info */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge {...getStatusBadge(selectedIsDraft ? 'DRAFT' : (selectedAgent as Agent).status)}>
                    {selectedIsDraft ? 'DRAFT' : (selectedAgent as Agent).status}
                  </Badge>
                  {!selectedIsDraft && (selectedAgent as Agent).target?.prUrl && (
                    <a
                      href={(selectedAgent as Agent).target!.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm flex items-center gap-1 hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      View PR
                    </a>
                  )}
                  {!selectedIsDraft && (selectedAgent as Agent).target?.url && (
                    <a
                      href={(selectedAgent as Agent).target!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm flex items-center gap-1 hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      Open in Cursor
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <GitBranch className="size-4" />
                  {selectedIsDraft
                    ? (selectedAgent as DraftAgent).repository
                    : (selectedAgent as Agent).source.repository}
                  <span className="text-muted-foreground/50">@</span>
                  {selectedIsDraft
                    ? (selectedAgent as DraftAgent).ref
                    : (selectedAgent as Agent).source.ref}
                </div>
                {!selectedIsDraft && (selectedAgent as Agent).summary && (
                  <p className="text-sm text-muted-foreground">{(selectedAgent as Agent).summary}</p>
                )}
              </div>

              {/* Conversation History */}
              {!selectedIsDraft && (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <Label className="mb-2">Conversation</Label>
                  <ScrollArea className="flex-1 border rounded-md overflow-hidden">
                    <div className="p-3">
                      {isLoadingConversation ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : conversation?.messages.length ? (
                        <div className="space-y-3">
                          {conversation.messages.map((msg) => (
                            <ConversationMessageItem key={msg.id} message={msg} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">No conversation yet</p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Draft Prompt */}
              {selectedIsDraft && (
                <div className="space-y-2">
                  <Label>Prompt</Label>
                  <div className="border rounded-md p-3 bg-muted/30 text-sm whitespace-pre-wrap">
                    {(selectedAgent as DraftAgent).prompt}
                  </div>
                </div>
              )}

              {/* Follow-up Input (for non-draft agents that aren't running or creating) */}
              {!selectedIsDraft && !['RUNNING', 'CREATING'].includes((selectedAgent as Agent).status) && (
                <div className="space-y-2">
                  <Label>Send Follow-up</Label>
                  <div className="flex gap-2">
                    <Textarea
                      value={followupText}
                      onChange={(e) => setFollowupText(e.target.value)}
                      placeholder="Type your follow-up message..."
                      className="min-h-[80px]"
                    />
                  </div>
                  <Button
                    onClick={handleSendFollowup}
                    disabled={!followupText.trim() || isSendingFollowup}
                    className="w-full"
                  >
                    {isSendingFollowup ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="size-4 mr-2" />
                    )}
                    Send Follow-up
                  </Button>
                </div>
              )}
            </div>
          )}

          <SheetFooter className="gap-2 mt-4">
            <Button variant="destructive" onClick={handleDeleteAgent} className="mr-auto">
              <Trash2 className="size-4 mr-2" />
              Delete
            </Button>
            {selectedIsDraft ? (
              <Button onClick={handleLaunchDraft} disabled={isCreating}>
                {isCreating ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Play className="size-4 mr-2" />
                )}
                Launch Agent
              </Button>
            ) : ['RUNNING', 'CREATING'].includes((selectedAgent as Agent)?.status) ? (
              <Button variant="outline" onClick={handleStopAgent}>
                <Square className="size-4 mr-2" />
                Stop Agent
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Create Agent Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Create New Agent</SheetTitle>
            <SheetDescription>
              Launch a new Cloud Agent or save as draft for later
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Agent name..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repository">Repository</Label>
              <Select
                value={createForm.repository}
                onValueChange={(value) => {
                  setCreateForm((f) => ({ ...f, repository: value, customRepo: '' }));
                  setLastRepository(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingRepos ? 'Loading...' : 'Select a repository'} />
                </SelectTrigger>
                <SelectContent>
                  {repositories.map((repo) => (
                    <SelectItem key={repo.repository} value={repo.repository}>
                      {repo.owner}/{repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">Or enter manually:</div>
              <Input
                value={createForm.customRepo}
                onChange={(e) => {
                  const value = e.target.value;
                  setCreateForm((f) => ({ ...f, customRepo: value, repository: '' }));
                  if (value) {
                    setLastRepository(value);
                  }
                }}
                placeholder="https://github.com/owner/repo"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ref">Branch/Ref</Label>
              <Input
                id="ref"
                value={createForm.ref}
                onChange={(e) => setCreateForm((f) => ({ ...f, ref: e.target.value }))}
                placeholder="main"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={createForm.prompt}
                onChange={(e) => setCreateForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="Describe what you want the agent to do..."
                className="min-h-[120px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model (optional)</Label>
              <Select
                value={createForm.model || 'auto'}
                onValueChange={(value) => setCreateForm((f) => ({ ...f, model: value === 'auto' ? '' : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingModels ? 'Loading...' : 'Auto (recommended)'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (recommended)</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCreate(true)}
              disabled={!(createForm.repository || createForm.customRepo) || !createForm.prompt.trim()}
            >
              Save as Draft
            </Button>
            <Button
              onClick={() => handleCreate(false)}
              disabled={!(createForm.repository || createForm.customRepo) || !createForm.prompt.trim() || isCreating}
            >
              {isCreating ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Play className="size-4 mr-2" />
              )}
              Launch Now
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
