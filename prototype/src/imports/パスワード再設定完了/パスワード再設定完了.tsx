function Group() {
  return (
    <div className="absolute left-[calc(33.33%+112.33px)] size-[108px] top-[210px]">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 108 108">
        <g id="Group 2">
          <circle cx="54" cy="54" fill="var(--fill-0, #D9D9D9)" id="Ellipse 1" r="54" />
        </g>
      </svg>
    </div>
  );
}

function Group1() {
  return (
    <div className="absolute contents left-[calc(33.33%+70.33px)] top-[427px]">
      <div className="absolute bg-white border border-[#8e8e93] border-solid h-[34px] left-[calc(33.33%+70.67px)] rounded-[3px] top-[428px] w-[192px]" />
      <p className="-translate-x-1/2 absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium','Noto_Sans_Symbols:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+167.17px)] text-[#1c1c1e] text-[10px] text-center top-[438px] tracking-[0.8px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ログイン画面へ →
      </p>
    </div>
  );
}

export default function Component() {
  return (
    <div className="bg-white border border-black border-solid relative size-full" data-name="パスワード再設定完了">
      <div className="absolute border border-[#696969] border-solid h-[798px] left-[-1px] top-[-1px] w-[1440px]" />
      <p className="absolute font-['Montserrat:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+67.33px)] text-[#1c1c1e] text-[40px] top-[102px] tracking-[3.2px] whitespace-nowrap">TRAKON</p>
      <div className="absolute bg-[#d9d9d9] h-[40px] left-[-1px] top-[757px] w-[1000px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+136.33px)] text-[11px] text-black top-[769px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ©TRAKON
      </p>
      <Group />
      <div className="-translate-x-1/2 absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Bold','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[0] left-[calc(33.33%+166.33px)] text-[#1c1c1e] text-[0px] text-center top-[347px] tracking-[0.8px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        <p className="font-['Noto_Sans:SemiBold','Noto_Sans_JP:Bold','Noto_Sans_JP:Medium',sans-serif] font-semibold leading-[normal] mb-0 text-[18px] whitespace-pre" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
          パスワードを更新しました。
        </p>
        <p className="leading-[normal] mb-0 text-[10px] whitespace-pre">​</p>
        <p className="leading-[normal] text-[10px] whitespace-pre">新しいパスワードでログインしてください。</p>
      </div>
      <Group1 />
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_Symbols2:Regular',sans-serif] font-medium leading-[normal] left-[calc(33.33%+149.33px)] text-[40px] text-black top-[237px] tracking-[3.2px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ✓
      </p>
    </div>
  );
}