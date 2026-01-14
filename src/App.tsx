import * as React from 'react';
import CloudAgentsKanban from '@/components/kanban/default';
import { ApiKeyModal, ApiKeySettingsButton } from '@/components/api-key-modal';
import { getApiKey } from '@/lib/cursor-api';

function App() {
  const [apiKeySet, setApiKeySet] = React.useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = React.useState(false);

  // Check for API key on mount
  React.useEffect(() => {
    const hasKey = !!getApiKey();
    setApiKeySet(hasKey);
    if (!hasKey) {
      setShowApiKeyModal(true);
    }
  }, []);

  const handleApiKeySuccess = () => {
    setApiKeySet(true);
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="mx-auto max-w-[1600px] w-full px-6 pt-6 pb-2 flex-shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cloud Agents</h1>
            <p className="text-sm text-muted-foreground">
              Manage your Cursor Cloud Agents
            </p>
          </div>
          <ApiKeySettingsButton onClick={() => setShowApiKeyModal(true)} />
        </div>
      </div>

      {/* Kanban Board - takes remaining height */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <CloudAgentsKanban
          apiKeySet={apiKeySet}
          onOpenSettings={() => setShowApiKeyModal(true)}
        />
      </div>

      {/* API Key Modal */}
      <ApiKeyModal
        open={showApiKeyModal}
        onOpenChange={setShowApiKeyModal}
        onSuccess={handleApiKeySuccess}
      />
    </div>
  );
}

export default App;
