import { useNavigate } from "react-router";
import { Plus, LogOut, Settings } from "lucide-react";

export function ProjectListPage() {
  const navigate = useNavigate();

  const handleLogout = () => {
    navigate("/login");
  };

  const mockProjects = [
    {
      id: 1,
      name: "ECサイトリニューアル",
      startDate: "2026-05-01",
      endDate: "2026-06-30",
      updatedAt: "2026-05-09",
    },
    {
      id: 2,
      name: "コーポレートサイト制作",
      startDate: "2026-04-15",
      endDate: "2026-05-31",
      updatedAt: "2026-05-08",
    },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1>TRAKON</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">田中 太郎</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4" />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2>プロジェクト</h2>
          <button
            onClick={() => navigate("/projects/new")}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            新規作成
          </button>
        </div>

        <div className="grid gap-4">
          {mockProjects.map((project) => (
            <div
              key={project.id}
              className="bg-white border border-border rounded-lg p-6 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <button
                  onClick={() => navigate(`/projects/${project.id}/deliverables/1`)}
                  className="flex-1 text-left"
                >
                  <h3>{project.name}</h3>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/projects/${project.id}/edit`);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  編集
                </button>
              </div>
              <div className="text-muted-foreground space-y-1">
                <p>
                  期間: {project.startDate} 〜 {project.endDate}
                </p>
                <p>最終更新: {project.updatedAt}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
