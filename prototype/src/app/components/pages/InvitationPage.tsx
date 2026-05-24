import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export function InvitationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [hasAccount, setHasAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const mockInvitation = {
    projectName: "ECサイトリニューアル",
    inviterName: "田中 太郎",
    role: "制作メンバー",
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa]">
        <div className="bg-white rounded-lg border border-border p-8 shadow-sm max-w-md w-full">
          <h2 className="mb-4">無効な招待リンク</h2>
          <p className="text-muted-foreground mb-6">
            招待リンクが無効または期限切れです。
          </p>
          <button
            onClick={() => navigate("/login")}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            ログインページへ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa]">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <h1 className="mb-2 tracking-tight">TRAKON</h1>
          <p className="text-muted-foreground">Keep the ball moving.</p>
        </div>

        <div className="bg-white rounded-lg border border-border p-8 shadow-sm">
          <div className="mb-6">
            <h2>プロジェクトへの招待</h2>
          </div>

          <div className="mb-6 p-4 bg-muted/50 rounded-lg space-y-2">
            <div>
              <span className="text-muted-foreground">プロジェクト:</span>{" "}
              <span className="font-medium">{mockInvitation.projectName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">招待者:</span>{" "}
              <span className="font-medium">{mockInvitation.inviterName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">役割:</span>{" "}
              <span className="font-medium">{mockInvitation.role}</span>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex gap-4">
              <button
                onClick={() => setHasAccount(false)}
                className={`flex-1 py-2 rounded-md border transition-colors ${
                  !hasAccount
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white border-border hover:bg-accent"
                }`}
              >
                新規登録
              </button>
              <button
                onClick={() => setHasAccount(true)}
                className={`flex-1 py-2 rounded-md border transition-colors ${
                  hasAccount
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white border-border hover:bg-accent"
                }`}
              >
                ログイン
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block mb-2">
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block mb-2">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {!hasAccount && (
              <div>
                <label htmlFor="passwordConfirm" className="block mb-2">
                  パスワード（確認）
                </label>
                <input
                  id="passwordConfirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              {hasAccount ? "ログインして参加" : "アカウントを作成して参加"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
