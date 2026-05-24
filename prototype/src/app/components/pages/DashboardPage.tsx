import { useNavigate } from "react-router";
import { Calendar, AlertCircle } from "lucide-react";

type BallCategory =
  | "wireframe"
  | "design"
  | "coding"
  | "review"
  | "meeting"
  | "other";

const CATEGORY_COLORS: Record<BallCategory, { bg: string; border: string }> = {
  wireframe: { bg: "bg-purple-50", border: "border-purple-300" },
  design: { bg: "bg-blue-50", border: "border-blue-300" },
  coding: { bg: "bg-green-50", border: "border-green-300" },
  review: { bg: "bg-orange-50", border: "border-orange-300" },
  meeting: { bg: "bg-yellow-50", border: "border-yellow-300" },
  other: { bg: "bg-gray-50", border: "border-gray-300" },
};

interface Project {
  id: string;
  name: string;
  color: string;
}

interface Member {
  id: string;
  name: string;
}

interface TodayTask {
  ballId: string;
  projectId: string;
  taskName: string;
  deliverable: string;
  ballHolder: string;
  status: "ready" | "tossed" | "completed";
  startDate: string;
  endDate: string;
  category: BallCategory;
}

export function DashboardPage() {
  const navigate = useNavigate();

  const mockProjects: Project[] = [
    { id: "1", name: "ECサイトリニューアル", color: "#3b82f6" },
    { id: "2", name: "コーポレートサイト制作", color: "#10b981" },
    { id: "3", name: "モバイルアプリ開発", color: "#f59e0b" },
  ];

  const mockMembers: Member[] = [
    { id: "1", name: "田中 太郎" },
    { id: "2", name: "佐藤 花子" },
    { id: "3", name: "鈴木 次郎" },
  ];

  const todayTasks: TodayTask[] = [
    {
      ballId: "1",
      projectId: "1",
      taskName: "構成作成",
      deliverable: "LPA（ランディングページA）",
      ballHolder: "田中 太郎",
      status: "ready",
      startDate: "2026-04-15",
      endDate: "2026-05-02",
      category: "wireframe",
    },
    {
      ballId: "5",
      projectId: "1",
      taskName: "デザイン",
      deliverable: "LPA（ランディングページA）",
      ballHolder: "佐藤 花子",
      status: "ready",
      startDate: "2026-05-11",
      endDate: "2026-05-25",
      category: "design",
    },
    {
      ballId: "15",
      projectId: "2",
      taskName: "構成作成",
      deliverable: "LPB（ランディングページB）",
      ballHolder: "田中 太郎",
      status: "ready",
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      category: "wireframe",
    },
    {
      ballId: "28",
      projectId: "3",
      taskName: "構成作成",
      deliverable: "LPC（ランディングページC）",
      ballHolder: "田中 太郎",
      status: "ready",
      startDate: "2026-05-15",
      endDate: "2026-05-28",
      category: "wireframe",
    },
  ];

  const today = new Date("2026-05-24");
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const activeTodayTasks = todayTasks.filter(
    (task) =>
      task.status !== "completed" &&
      task.startDate <= todayStr &&
      task.endDate >= todayStr
  );

  const isOverdue = (endDate: string, status: string) => {
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    return status === "ready" && end < today;
  };

  const overdueTasks = activeTodayTasks.filter((t) =>
    isOverdue(t.endDate, t.status)
  );

  const tasksByProjectAndMember = mockProjects.map((project) => {
    const projectTasks = activeTodayTasks.filter(
      (task) => task.projectId === project.id
    );

    const memberTasks = mockMembers
      .map((member) => ({
        member,
        tasks: projectTasks.filter((task) => task.ballHolder === member.name),
      }))
      .filter((mt) => mt.tasks.length > 0);

    return {
      project,
      memberTasks,
      totalTasks: projectTasks.length,
    };
  }).filter((p) => p.totalTasks > 0);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-border">
        <div className="px-6 py-6">
          <h1 className="mb-2">ダッシュボード</h1>
          <p className="text-muted-foreground">
            今日（{today.getFullYear()}/{today.getMonth() + 1}/{today.getDate()}）のプロジェクトとメンバーの状況
          </p>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">今日のタスク</div>
                <div className="text-2xl font-bold">{activeTodayTasks.length}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">期限超過</div>
                <div className="text-2xl font-bold text-red-600">
                  {overdueTasks.length}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {tasksByProjectAndMember.length === 0 ? (
            <div className="bg-white border border-border rounded-lg p-12 text-center text-muted-foreground">
              今日のタスクはありません
            </div>
          ) : (
            tasksByProjectAndMember.map(({ project, memberTasks }) => (
              <div
                key={project.id}
                className="bg-white border border-border rounded-lg"
              >
                <div className="px-6 py-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <h2>{project.name}</h2>
                    <span className="text-sm text-muted-foreground ml-2">
                      ({memberTasks.reduce((sum, mt) => sum + mt.tasks.length, 0)}
                      件)
                    </span>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {memberTasks.map(({ member, tasks }) => (
                    <div key={member.id}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-xs font-medium">
                          {member.name.charAt(0)}
                        </div>
                        <h3 className="text-base">{member.name}</h3>
                        <span className="text-sm text-muted-foreground">
                          ({tasks.length}件)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 ml-10">
                        {tasks.map((task) => {
                          const overdueTask = isOverdue(task.endDate, task.status);
                          const categoryColors = CATEGORY_COLORS[task.category];

                          return (
                            <button
                              key={task.ballId}
                              onClick={() =>
                                navigate(
                                  `/projects/${task.projectId}/deliverables/1`,
                                  { state: { scrollToBallId: task.ballId } }
                                )
                              }
                              className={`border-2 rounded-lg p-4 hover:shadow-md transition-all text-left ${
                                overdueTask
                                  ? "bg-red-50 border-red-400 hover:border-red-500"
                                  : `${categoryColors.bg} ${categoryColors.border} hover:border-primary/40`
                              }`}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium truncate mb-1 ${
                                      overdueTask ? "text-red-700" : ""
                                    }`}
                                  >
                                    {task.taskName}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {task.deliverable}
                                  </div>
                                </div>
                              </div>

                              <div
                                className={`text-xs ${
                                  overdueTask
                                    ? "text-red-600"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {new Date(task.startDate).getFullYear()}/
                                {new Date(task.startDate).getMonth() + 1}/
                                {new Date(task.startDate).getDate()} 〜{" "}
                                {new Date(task.endDate).getFullYear()}/
                                {new Date(task.endDate).getMonth() + 1}/
                                {new Date(task.endDate).getDate()}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
