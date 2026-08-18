import { createFileRoute } from "@tanstack/react-router";
import { SettingsForm } from "@/components/settings-form";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="font-heading text-lg font-medium">设置</h1>
        <p className="text-sm text-muted-foreground">
          除非你把它指向云端 API，否则所有数据都不会离开这台机器。
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
