'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiKey, setApiKey, testConnection, clearApiKey } from '@/lib/cursor-api';
import { Key, CheckCircle2, XCircle, Loader2, Settings } from 'lucide-react';

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ApiKeyModal({ open, onOpenChange, onSuccess }: ApiKeyModalProps) {
  const [apiKey, setApiKeyValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [userEmail, setUserEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      const existingKey = getApiKey();
      if (existingKey) {
        setApiKeyValue(existingKey);
      }
    }
  }, [open]);

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setIsLoading(true);
    setError(null);
    setUserEmail(null);

    // Temporarily set the key to test it
    const previousKey = getApiKey();
    setApiKey(apiKey.trim());

    try {
      const info = await testConnection();
      setUserEmail(info.userEmail);
      setError(null);
    } catch (err) {
      // Restore previous key if test fails
      if (previousKey) {
        setApiKey(previousKey);
      } else {
        clearApiKey();
      }
      setError(err instanceof Error ? err.message : 'Connection failed');
      setUserEmail(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim() || !userEmail) {
      setError('Please test the connection first');
      return;
    }

    setApiKey(apiKey.trim());
    onOpenChange(false);
    onSuccess?.();
  };

  const handleClear = () => {
    clearApiKey();
    setApiKeyValue('');
    setUserEmail(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5" />
            Cursor API Key
          </DialogTitle>
          <DialogDescription>
            Enter your Cursor API key to connect to Cloud Agents. You can find your API key in your{' '}
            <a
              href="https://cursor.com/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:no-underline"
            >
              Cursor Dashboard
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKeyValue(e.target.value);
                setUserEmail(null);
                setError(null);
              }}
              placeholder="Enter your Cursor API key..."
              className="font-mono"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <XCircle className="size-4" />
              {error}
            </div>
          )}

          {userEmail && (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 className="size-4" />
              Connected as {userEmail}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {getApiKey() && (
            <Button variant="outline" onClick={handleClear} className="mr-auto">
              Clear Key
            </Button>
          )}
          <Button variant="outline" onClick={handleTestConnection} disabled={isLoading || !apiKey.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
          <Button onClick={handleSave} disabled={!userEmail}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Settings button component to open the modal
interface ApiKeySettingsButtonProps {
  onClick: () => void;
}

export function ApiKeySettingsButton({ onClick }: ApiKeySettingsButtonProps) {
  return (
    <Button variant="ghost" size="sm" mode="icon" onClick={onClick} title="API Settings">
      <Settings className="size-4" />
    </Button>
  );
}
