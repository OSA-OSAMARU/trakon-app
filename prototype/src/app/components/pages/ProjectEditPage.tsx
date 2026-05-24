import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { X, Plus, Settings } from "lucide-react";

interface Deliverable {
  id: string;
  name: string;
}

interface Participant {
  id: string;
  name: string;
  organization: string;
  email: string;
  type: "client" | "production";
}

export function ProjectEditPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [projectName, setProjectName] = useState("ECサイトリニューアル");
  const [startDate, setStartDate] = useState("2026-05-01");
  const [endDate, setEndDate] = useState("2026-06-30");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([
    { id: "1", name: "トップページ" },
    { id: "2", name: "商品一覧ページ" },
  ]);
  const [participants, setParticipants] = useState<Participant[]>([
    {
      id: "1",
      name: "田中 太郎",
      organization: "制作会社A",
      email: "tanaka@example.com",
      type: "production",
    },
    {
      id: "2",
      name: "佐藤 花子",
      organization: "制作会社A",
      email: "sato@example.com",
      type: "production",
    },
    {
      id: "3",
      name: "鈴木 次郎",
      organization: "クライアントB",
      email: "suzuki@example.com",
      type: "client",
    },
  ]);

  const addDeliverable = () => {
    setDeliverables([
      ...deliverables,
      { id: Date.now().toString(), name: "" },
    ]);
  };

  const removeDeliverable = (id: string) => {
    if (deliverables.length > 1) {
      setDeliverables(deliverables.filter((d) => d.id !== id));
    }
  };

  const updateDeliverable = (id: string, name: string) => {
    setDeliverables(
      deliverables.map((d) => (d.id === id ? { ...d, name } : d))
    );
  };

  const addParticipant = () => {
    setParticipants([
      ...participants,
      {
        id: Date.now().toString(),
        name: "",
        organization: "",
        email: "",
        type: "production",
      },
    ]);
  };

  const removeParticipant = (id: string) => {
    setParticipants(participants.filter((p) => p.id !== id));
  };

  const updateParticipant = (
    id: string,
    field: keyof Participant,
    value: string
  ) => {
    setParticipants(
      participants.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/projects/${projectId}/deliverables/1`);
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <h1>プロジェクト編集</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white border border-border rounded-lg p-6">
            <h3 className="mb-6">基本情報</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="projectName" className="block mb-2">
                  プロジェクト名 <span className="text-destructive">*</span>
                </label>
                <input
                  id="projectName"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="startDate" className="block mb-2">
                    開始日 <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="endDate" className="block mb-2">
                    終了日 <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h3>
                制作物 <span className="text-destructive">*</span>
              </h3>
              <button
                type="button"
                onClick={addDeliverable}
                className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
              >
                <Plus className="w-4 h-4" />
                追加
              </button>
            </div>

            <div className="space-y-3">
              {deliverables.map((deliverable) => (
                <div key={deliverable.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={deliverable.name}
                    onChange={(e) =>
                      updateDeliverable(deliverable.id, e.target.value)
                    }
                    className="flex-1 px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                  {deliverables.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDeliverable(deliverable.id)}
                      className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h3>参加者</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/projects/${projectId}/participants`)
                  }
                  className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  参加者管理
                </button>
                <button
                  type="button"
                  onClick={addParticipant}
                  className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  追加
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className="grid grid-cols-12 gap-3 items-start pb-4 border-b border-border last:border-b-0 last:pb-0"
                >
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={participant.name}
                      onChange={(e) =>
                        updateParticipant(participant.id, "name", e.target.value)
                      }
                      placeholder="氏名"
                      className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={participant.organization}
                      onChange={(e) =>
                        updateParticipant(
                          participant.id,
                          "organization",
                          e.target.value
                        )
                      }
                      placeholder="所属"
                      className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="email"
                      value={participant.email}
                      onChange={(e) =>
                        updateParticipant(participant.id, "email", e.target.value)
                      }
                      placeholder="メールアドレス"
                      className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="col-span-2">
                    <select
                      value={participant.type}
                      onChange={(e) =>
                        updateParticipant(
                          participant.id,
                          "type",
                          e.target.value as "client" | "production"
                        )
                      }
                      className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="production">制作</option>
                      <option value="client">クライアント</option>
                    </select>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeParticipant(participant.id)}
                      className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/deliverables/1`)}
              className="px-6 py-2.5 border border-border rounded-md hover:bg-accent transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              保存
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
