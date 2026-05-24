import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Mail, Check } from "lucide-react";

type Screen =
  | "signup"
  | "email-sent"
  | "create-account"
  | "login"
  | "password-reset-request"
  | "password-reset-email-sent"
  | "password-reset"
  | "password-reset-complete";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [screen, setScreen] = useState<Screen>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    const token = searchParams.get("token");
    const resetToken = searchParams.get("reset-token");
    if (token) {
      setScreen("create-account");
    } else if (resetToken) {
      setScreen("password-reset");
    }
  }, [searchParams]);

  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  const handleSignupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setScreen("email-sent");
  };

  const handlePasswordResetRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setScreen("password-reset-email-sent");
  };

  const handlePasswordReset = (e: React.FormEvent) => {
    e.preventDefault();
    setScreen("password-reset-complete");
  };

  const handleResend = () => {
    setResendCountdown(60);
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="flex-1 flex flex-col items-center pt-24">
        <h1 className="text-[40px] font-extrabold tracking-[3.2px] mb-12">TRAKON</h1>

        {screen === "login" && (
          <div className="w-[320px]">
            <h2 className="text-[20px] font-extrabold tracking-[1.6px] text-center mb-12">
              ログイン
            </h2>

            <form onSubmit={handleLoginSubmit} className="space-y-6">
              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  パスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3 h-3 bg-[#d9d9d9] border-[#8e8e93]"
                />
                <label htmlFor="rememberMe" className="text-[11px] font-medium tracking-[0.88px]">
                  ログイン状態を保存する
                </label>
              </div>

              <button
                type="submit"
                className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[12px] font-medium tracking-[0.96px]"
              >
                ログイン→
              </button>
            </form>

            <button
              onClick={() => setScreen("password-reset-request")}
              className="w-full mt-6 text-[11px] font-medium tracking-[0.88px] underline hover:opacity-70 transition-opacity"
            >
              パスワードをお忘れですか？
            </button>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 border-t border-[#8e8e93]" />
              <span className="text-[11px] font-medium tracking-[0.88px]">または</span>
              <div className="flex-1 border-t border-[#8e8e93]" />
            </div>

            <div className="mt-6 space-y-3">
              <button className="w-full h-[36px] border-[0.5px] border-[#8e8e93] hover:bg-accent transition-colors text-[11px] font-medium tracking-[0.88px]">
                Google で続ける
              </button>
              <button className="w-full h-[36px] border-[0.5px] border-[#8e8e93] hover:bg-accent transition-colors text-[11px] font-medium tracking-[0.88px]">
                Microsoft で続ける
              </button>
            </div>

            <button
              onClick={() => setScreen("signup")}
              className="w-full mt-6 text-[11px] tracking-[0.88px] hover:opacity-70 transition-opacity"
            >
              アカウントをお持ちでない方は新規登録
            </button>
          </div>
        )}

        {screen === "signup" && (
          <div className="w-[320px]">
            <h2 className="text-[20px] font-extrabold tracking-[1.6px] text-center mb-12">
              はじめる
            </h2>

            <form onSubmit={handleSignupSubmit} className="space-y-6">
              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-black rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[12px] font-medium tracking-[0.96px]"
              >
                はじめる→
              </button>
            </form>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 border-t border-[#8e8e93]" />
              <span className="text-[11px] font-medium tracking-[0.88px]">または</span>
              <div className="flex-1 border-t border-[#8e8e93]" />
            </div>

            <div className="mt-6 space-y-3">
              <button className="w-full h-[36px] border-[0.5px] border-[#8e8e93] hover:bg-accent transition-colors text-[11px] font-medium tracking-[0.88px]">
                Google でログイン
              </button>
              <button className="w-full h-[36px] border-[0.5px] border-[#8e8e93] hover:bg-accent transition-colors text-[11px] font-medium tracking-[0.88px]">
                Microsoft でログイン
              </button>
            </div>

            <p className="mt-8 text-[10px] font-medium tracking-[0.8px] text-center leading-normal">
              続けることで、
              <span className="underline">利用規約</span>
              {` および `}
              <span className="underline">プライバシーポリシー</span>
              {` に`}
              <br />
              同意したものとみなされます。
            </p>

            <button
              onClick={() => setScreen("login")}
              className="w-full mt-6 text-[11px] tracking-[0.88px] hover:opacity-70 transition-opacity"
            >
              アカウントをお持ちの方はログイン
            </button>
          </div>
        )}

        {screen === "email-sent" && (
          <div className="w-[400px]">
            <div className="flex flex-col items-center mb-12">
              <div className="w-[108px] h-[108px] bg-[#d9d9d9] rounded-full flex items-center justify-center mb-6">
                <Mail className="w-[32px] h-[32px] text-[#21272a]" />
              </div>

              <div className="text-[10px] font-medium tracking-[0.8px] text-center leading-normal space-y-1">
                <p>メールを送信しました</p>
                <p>{email} に</p>
                <p>アカウント作成用のリンクを送りました。</p>
                <p>メールに記載のリンクをクリックしてください。</p>
                <p>&nbsp;</p>
                <p>メールが見つからない場合は</p>
                <p>迷惑メールフォルダもご確認ください。</p>
              </div>
            </div>

            <button
              onClick={handleResend}
              disabled={resendCountdown > 0}
              className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[10px] font-medium tracking-[0.8px] underline disabled:opacity-50"
            >
              メールが届かない場合は再送する
            </button>

            {resendCountdown > 0 && (
              <p className="mt-4 text-[10px] font-medium tracking-[0.8px] text-center text-[#696969]">
                ✓再送しました。次の再送まで{" "}
                <span className="font-bold">{resendCountdown}</span> 秒
              </p>
            )}

            <div className="mt-8 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center mb-2">
                開発用
              </p>
              <button
                onClick={() => setScreen("create-account")}
                className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
              >
                アカウント作成画面へ進む
              </button>
            </div>
          </div>
        )}

        {screen === "password-reset-request" && (
          <div className="w-[320px]">
            <div className="text-[14px] tracking-[1.12px] mb-12 space-y-1">
              <p className="font-medium">パスワードをお忘れですか？</p>
              <p className="font-normal">登録済みのメールアドレスを入力してください。</p>
              <p className="font-normal">パスワード再設定用のリンクをお送りします。</p>
            </div>

            <form onSubmit={handlePasswordResetRequest} className="space-y-6">
              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[12px] font-medium tracking-[0.96px]"
              >
                再設定メールを送る→
              </button>
            </form>

            <button
              onClick={() => setScreen("login")}
              className="w-full mt-6 text-[12px] tracking-[0.96px] underline hover:opacity-70 transition-opacity"
            >
              ログイン画面に戻る
            </button>
          </div>
        )}

        {screen === "password-reset-email-sent" && (
          <div className="w-[400px]">
            <div className="flex flex-col items-center mb-12">
              <div className="w-[108px] h-[108px] bg-[#d9d9d9] rounded-full flex items-center justify-center mb-6">
                <Mail className="w-[32px] h-[32px] text-[#21272a]" />
              </div>

              <div className="text-[10px] font-medium tracking-[0.8px] text-center leading-normal space-y-1">
                <p>メールを送信しました</p>
                <p>{email} に</p>
                <p>アカウント作成用のリンクを送りました。</p>
                <p>メールに記載のリンクをクリックしてください。</p>
                <p>&nbsp;</p>
                <p>メールが見つからない場合は</p>
                <p>迷惑メールフォルダもご確認ください。</p>
              </div>
            </div>

            <button
              onClick={handleResend}
              disabled={resendCountdown > 0}
              className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[10px] font-medium tracking-[0.8px] underline disabled:opacity-50"
            >
              メールが届かない場合は再送する
            </button>

            {resendCountdown > 0 && (
              <p className="mt-4 text-[10px] font-medium tracking-[0.8px] text-center text-[#696969]">
                ✓再送しました。次の再送まで{" "}
                <span className="font-bold">{resendCountdown}</span> 秒
              </p>
            )}

            <div className="mt-8 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center mb-2">
                開発用
              </p>
              <button
                onClick={() => setScreen("password-reset")}
                className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
              >
                パスワード再設定画面へ進む
              </button>
            </div>
          </div>
        )}

        {screen === "password-reset" && (
          <div className="w-[320px]">
            <div className="text-[14px] tracking-[1.12px] mb-12 space-y-1">
              <p className="font-medium leading-[33px]">新しいパスワードを設定</p>
              <p className="font-normal leading-[33px]">8文字以上で設定して下さい。</p>
            </div>

            <form onSubmit={handlePasswordReset} className="space-y-6">
              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  新しいパスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  minLength={8}
                  required
                />
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex gap-1 flex-1">
                    <div className="h-[3px] bg-[#d9d9d9] flex-1" />
                    <div className="h-[3px] bg-[#d9d9d9] flex-1" />
                    <div className="h-[3px] bg-white border-[0.5px] border-[#d9d9d9] flex-1" />
                    <div className="h-[3px] bg-white border-[0.5px] border-[#d9d9d9] flex-1" />
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-[#8e8e93]">強度：中</p>
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  新しいパスワード（確認）
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  minLength={8}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[12px] font-medium tracking-[0.96px] mt-8"
              >
                パスワードを更新する→
              </button>
            </form>
          </div>
        )}

        {screen === "password-reset-complete" && (
          <div className="w-[400px]">
            <div className="flex flex-col items-center mb-12">
              <div className="w-[108px] h-[108px] bg-[#d9d9d9] rounded-full flex items-center justify-center mb-6">
                <Check className="w-[40px] h-[40px] text-black" />
              </div>

              <div className="text-center leading-normal space-y-1">
                <p className="text-[18px] font-semibold tracking-[0.8px]">
                  パスワードを更新しました。
                </p>
                <p className="text-[10px] font-medium tracking-[0.8px]">&nbsp;</p>
                <p className="text-[10px] font-medium tracking-[0.8px]">
                  新しいパスワードでログインしてください。
                </p>
              </div>
            </div>

            <button
              onClick={() => setScreen("login")}
              className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[10px] font-medium tracking-[0.8px]"
            >
              ログイン画面へ →
            </button>
          </div>
        )}

        {screen === "create-account" && (
          <div className="w-[320px]">
            <h2 className="text-[20px] font-extrabold tracking-[1.6px] text-center mb-12">
              アカウント
            </h2>

            <form onSubmit={handleCreateAccount} className="space-y-6">
              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  お名前
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  ユーザー名（表示名）
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  パスワード（8文字以上）
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium tracking-[1.12px] mb-3">
                  パスワード（確認）
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full h-[34px] px-3 bg-[#f5f5f5] border-[0.5px] border-[#8e8e93] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  minLength={8}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full h-[34px] bg-white border border-[#8e8e93] rounded-[3px] hover:bg-accent transition-colors text-[12px] font-medium tracking-[0.96px] mt-8"
              >
                プロジェクト作成 →
              </button>
            </form>
          </div>
        )}
      </div>

      <footer className="h-[40px] bg-[#d9d9d9] flex items-center justify-center">
        <p className="text-[11px] font-medium tracking-[0.88px] text-black">©TRAKON</p>
      </footer>
    </div>
  );
}
