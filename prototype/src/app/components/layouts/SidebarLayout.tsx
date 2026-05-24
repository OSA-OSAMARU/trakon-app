import { useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { Plus, FolderKanban } from "lucide-react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ProfileModal } from "../modals/ProfileModal";

export function SidebarLayout() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const mockProjects = [
    { id: "1", name: "ECサイトリニューアル", color: "#3b82f6" },
    { id: "2", name: "コーポレートサイト制作", color: "#10b981" },
    { id: "3", name: "モバイルアプリ開発", color: "#f59e0b" },
  ];

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="min-h-screen bg-background">
        <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-border flex flex-col z-40">
          <div className="p-6 border-b border-border">
            <h1
              className="text-2xl font-extrabold tracking-[3.2px] cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => navigate("/dashboard")}
            >
              TRAKON
            </h1>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="mb-4">
                <button
                  onClick={() => navigate("/dashboard")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left ${
                    window.location.pathname === "/dashboard"
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent"
                  }`}
                >
                  <FolderKanban className="w-4 h-4" />
                  <span className="text-sm">ダッシュボード</span>
                </button>
              </div>

              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  プロジェクト
                </h3>
                <button
                  onClick={() => navigate("/projects/new")}
                  className="p-1 hover:bg-accent rounded transition-colors"
                  title="新規プロジェクト"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                {mockProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/projects/${project.id}/deliverables/1`)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left ${
                      projectId === project.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="text-sm truncate">{project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-border">
            <button
              onClick={() => setProfileModalOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors"
            >
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-medium">
                U
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium truncate">ユーザー名</div>
                <div className="text-xs text-muted-foreground truncate">
                  user@example.com
                </div>
              </div>
            </button>
          </div>
        </aside>

        <main className="ml-64">
          <Outlet />
        </main>

        {profileModalOpen && (
          <ProfileModal onClose={() => setProfileModalOpen(false)} />
        )}
      </div>
    </DndProvider>
  );
}
