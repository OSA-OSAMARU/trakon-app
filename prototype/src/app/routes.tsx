import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/layouts/RootLayout";
import { SidebarLayout } from "./components/layouts/SidebarLayout";
import { LoginPage } from "./components/pages/LoginPage";
import { InvitationPage } from "./components/pages/InvitationPage";
import { DashboardPage } from "./components/pages/DashboardPage";
import { ProjectCreatePage } from "./components/pages/ProjectCreatePage";
import { ProjectEditPage } from "./components/pages/ProjectEditPage";
import { DeliverableSchedulePage } from "./components/pages/DeliverableSchedulePage";
import { MemberKanbanPage } from "./components/pages/MemberKanbanPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: LoginPage },
      { path: "login", Component: LoginPage },
      { path: "invitation", Component: InvitationPage },
      {
        path: "dashboard",
        Component: SidebarLayout,
        children: [{ index: true, Component: DashboardPage }],
      },
      {
        path: "projects",
        Component: SidebarLayout,
        children: [
          { path: "new", Component: ProjectCreatePage },
          { path: ":projectId/edit", Component: ProjectEditPage },
          {
            path: ":projectId/deliverables/:deliverableId",
            Component: DeliverableSchedulePage,
          },
          { path: ":projectId/members", Component: MemberKanbanPage },
        ],
      },
    ],
  },
]);
