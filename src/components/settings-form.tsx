import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listRemoteModels } from "@/lib/providers";
import {
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
} from "@/lib/settings";
import { PROVIDER_DEFAULTS, type ProviderId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const PROVIDER_ITEMS = [
  { label: "请选择服务商", value: null },
  ...Object.entries(PROVIDER_DEFAULTS).map(([value, meta]) => ({
    label: meta.label,
    value,
  })),
];

export function SettingsForm() {
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(false);

  useEffect(() => {
    void (async () => {
      const [settings, key] = await Promise.all([loadSettings(), loadApiKey()]);
      setProvider(settings.provider);
      setModel(settings.model);
      setBaseUrl(settings.baseUrl);
      setApiKey(key);
      setLoading(false);
    })();
  }, []);

  const needsKey = PROVIDER_DEFAULTS[provider].needsKey;

  async function refreshModels() {
    setListing(true);
    try {
      const ids = await listRemoteModels(provider, baseUrl, apiKey);
      setModels(ids);
      if (ids.length && !ids.includes(model)) {
        setModel(ids[0]);
      }
      if (!ids.length) {
        toast.error("没有找到任何模型，本地服务在运行吗？");
      }
    } finally {
      setListing(false);
    }
  }

  async function onSave() {
    setSaving(true);
    try {
      await saveSettings({ provider, model, baseUrl });
      await saveApiKey(apiKey);
      toast.success("设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>模型</CardTitle>
        <CardDescription>
          可以接本地的 Ollama 或 LM Studio，也可以填云端服务的密钥。密钥只保存在系统钥匙串里。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>服务商</FieldLabel>
            <Select
              items={PROVIDER_ITEMS}
              value={provider}
              onValueChange={(value) => {
                if (!value) return;
                const next = value as ProviderId;
                setProvider(next);
                setBaseUrl(PROVIDER_DEFAULTS[next].baseUrl);
                setModel(PROVIDER_DEFAULTS[next].model);
                setModels([]);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PROVIDER_ITEMS.filter((item) => item.value).map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="base-url">接口地址</FieldLabel>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <FieldDescription>
              Ollama 的默认地址是 http://127.0.0.1:11434/v1
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="model">模型</FieldLabel>
            <Input
              id="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="llama3.1"
            />
            {models.length ? (
              <FieldDescription>已找到：{models.slice(0, 8).join("，")}</FieldDescription>
            ) : null}
          </Field>
          {needsKey || provider === "custom" ? (
            <Field>
              <FieldLabel htmlFor="api-key">API 密钥</FieldLabel>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </Field>
          ) : null}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => void refreshModels()}
          disabled={listing}
        >
          {listing ? <Spinner data-icon="inline-start" /> : null}
          获取模型列表
        </Button>
        <Button onClick={() => void onSave()} disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          保存
        </Button>
      </CardFooter>
    </Card>
  );
}
