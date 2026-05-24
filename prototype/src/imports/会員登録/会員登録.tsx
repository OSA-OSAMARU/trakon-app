function Group() {
  return (
    <div className="absolute contents left-[calc(33.33%+85.33px)] top-[316px]">
      <div className="absolute bg-white border border-[#8e8e93] border-solid h-[34px] left-[calc(33.33%+85.67px)] rounded-[3px] top-[317px] w-[174px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+140.67px)] text-[#1c1c1e] text-[12px] top-[326px] tracking-[0.96px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        はじめる→
      </p>
    </div>
  );
}

export default function Component() {
  return (
    <div className="bg-white border border-black border-solid relative size-full" data-name="会員登録">
      <div className="absolute border border-[#696969] border-solid h-[798px] left-[-1px] top-[-1px] w-[1440px]" />
      <p className="absolute font-['Montserrat:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+67.33px)] text-[#1c1c1e] text-[40px] top-[102px] tracking-[3.2px] whitespace-nowrap">TRAKON</p>
      <p className="absolute font-['Noto_Sans:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+123.33px)] text-[#1c1c1e] text-[20px] top-[157px] tracking-[1.6px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        はじめる
      </p>
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+5.33px)] text-[#1c1c1e] text-[14px] top-[228px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        メールアドレス
      </p>
      <div className="absolute h-0 left-[calc(33.33%+5.33px)] top-[381px] w-[125px]">
        <div className="absolute inset-[-0.5px_0_0_0]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 125 0.5">
            <line id="Line 3" stroke="var(--stroke-0, #8E8E93)" strokeWidth="0.5" x2="125" y1="0.25" y2="0.25" />
          </svg>
        </div>
      </div>
      <div className="absolute h-0 left-[calc(50%+34px)] top-[381px] w-[125px]">
        <div className="absolute inset-[-0.5px_0_0_0]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 125 0.5">
            <line id="Line 3" stroke="var(--stroke-0, #8E8E93)" strokeWidth="0.5" x2="125" y1="0.25" y2="0.25" />
          </svg>
        </div>
      </div>
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+147.33px)] text-[#1c1c1e] text-[11px] top-[373px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        または
      </p>
      <div className="absolute border-[#8e8e93] border-[0.5px] border-solid h-[36px] left-[calc(33.33%+63.33px)] top-[410px] w-[202px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+111.33px)] text-[#1c1c1e] text-[11px] top-[420px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        Google でログイン
      </p>
      <div className="absolute border-[#8e8e93] border-[0.5px] border-solid h-[36px] left-[calc(33.33%+63.33px)] top-[453px] w-[202px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+104.33px)] text-[#1c1c1e] text-[11px] top-[463px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        Microsoft でログイン
      </p>
      <div className="absolute bg-[#d9d9d9] h-[40px] left-[-1px] top-[757px] w-[1000px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+136.33px)] text-[11px] text-black top-[769px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ©TRAKON
      </p>
      <div className="absolute bg-[#f5f5f5] border-[0.5px] border-black border-solid h-[34px] left-[calc(33.33%+5.33px)] rounded-[5px] top-[262px] w-[320px]" />
      <div className="-translate-x-1/2 absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[0] left-[calc(33.33%+172.83px)] text-[#1c1c1e] text-[10px] text-center top-[518px] tracking-[0.8px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        <p className="mb-0">
          <span className="leading-[normal]">続けることで、</span>
          <span className="[text-decoration-skip-ink:none] decoration-solid leading-[normal] underline">利用規約</span>
          <span className="leading-[normal]">{` および `}</span>
          <span className="[text-decoration-skip-ink:none] decoration-solid leading-[normal] underline">プライバシーポリシー</span>
          <span className="leading-[normal]">{` に`}</span>
        </p>
        <p className="leading-[normal]">同意したものとみなされます。</p>
      </div>
      <Group />
    </div>
  );
}