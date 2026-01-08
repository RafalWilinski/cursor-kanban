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
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1600px] p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cloud Agents</h1>
            <p className="text-sm text-muted-foreground">
              Manage your Cursor Cloud Agents
            </p>
          </div>
          <ApiKeySettingsButton onClick={() => setShowApiKeyModal(true)} />
        </div>

        {/* Kanban Board */}
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
