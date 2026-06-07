import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction } from 'lucide-react';

interface PlaceholderProps {
  title: string;
  description: string;
  step: string; // which step will fill this in
}

/**
 * Generic placeholder for in-progress settings tabs.
 * Replaced by real per-tab pages in Step 6-8.
 */
export function SettingsTabPlaceholder({ title, description, step }: PlaceholderProps) {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-amber-500" />
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Coming in {step}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
