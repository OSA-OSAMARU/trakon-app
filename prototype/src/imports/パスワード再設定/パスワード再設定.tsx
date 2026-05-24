function Group() {
  return (
    <div className="absolute contents left-[calc(33.33%+5.33px)] top-[280px]">
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+5.67px)] text-[#1c1c1e] text-[14px] top-[281px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        新しいパスワード
      </p>
      <div className="absolute bg-[#f5f5f5] border-[#8e8e93] border-[0.5px] border-solid h-[34px] left-[calc(33.33%+5.67px)] rounded-[5px] top-[307px] w-[321px]" />
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_Symbols2:Regular',sans-serif] font-medium leading-[normal] left-[calc(33.33%+17.67px)] text-[14px] text-black top-[314px] tracking-[4.76px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ●●●●●●●●
      </p>
    </div>
  );
}

function Group3() {
  return (
    <div className="absolute contents left-[calc(33.33%+5.33px)] top-[393px]">
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+5.67px)] text-[#1c1c1e] text-[14px] top-[394px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        新しいパスワード（確認）
      </p>
      <div className="absolute bg-[#f5f5f5] border-[#8e8e93] border-[0.5px] border-solid h-[34px] left-[calc(33.33%+5.67px)] rounded-[5px] top-[420px] w-[321px]" />
    </div>
  );
}

function Group1() {
  return (
    <div className="absolute contents left-[calc(33.33%+80.33px)] top-[491px]">
      <div className="absolute bg-white border border-[#8e8e93] border-solid h-[34px] left-[calc(33.33%+80.67px)] rounded-[3px] top-[492px] w-[174px]" />
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium','Noto_Sans_Symbols:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+95.67px)] text-[#1c1c1e] text-[12px] top-[501px] tracking-[0.96px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        パスワードを更新する→
      </p>
    </div>
  );
}

function Group2() {
  return (
    <div className="absolute contents left-[calc(33.33%+5.33px)] top-[344px]">
      <div className="absolute bg-[#d9d9d9] h-[3px] left-[calc(33.33%+5.67px)] top-[345px] w-[78.354px]" />
      <div className="absolute bg-[#d9d9d9] h-[3px] left-[calc(33.33%+86.55px)] top-[345px] w-[78.354px]" />
      <div className="absolute bg-white border-[#d9d9d9] border-[0.5px] border-solid h-[3px] left-[calc(50%+0.76px)] top-[345px] w-[78.354px]" />
      <div className="absolute bg-white border-[#d9d9d9] border-[0.5px] border-solid h-[3px] left-[calc(50%+81.65px)] top-[345px] w-[78.354px]" />
    </div>
  );
}

export default function Component() {
  return (
    <div className="bg-white border border-black border-solid relative size-full" data-name="パスワード再設定">
      <div className="absolute border border-[#696969] border-solid h-[798px] left-[-1px] top-[-1px] w-[1440px]" />
      <p className="absolute font-['Montserrat:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+67.33px)] text-[#1c1c1e] text-[40px] top-[102px] tracking-[3.2px] whitespace-nowrap">TRAKON</p>
      <div className="absolute bg-[#d9d9d9] h-[40px] left-[-1px] top-[757px] w-[1000px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+136.33px)] text-[11px] text-black top-[769px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ©TRAKON
      </p>
      <Group />
      <Group3 />
      <Group1 />
      <div className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium','Noto_Sans_JP:Regular',sans-serif] font-medium leading-[0] left-[calc(33.33%+5.33px)] text-[#1c1c1e] text-[14px] top-[186px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        <p className="leading-[33px] mb-0">新しいパスワードを設定</p>
        <p className="font-['Noto_Sans:Regular','Noto_Sans_JP:Medium','Noto_Sans_JP:Regular',sans-serif] font-normal leading-[33px]" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
          8文字以上で設定して下さい。
        </p>
      </div>
      <Group2 />
      <p className="absolute font-['Noto_Sans:Regular','Noto_Sans_JP:Regular',sans-serif] font-normal leading-[normal] left-[calc(33.33%+9.33px)] text-[#8e8e93] text-[10px] top-[351px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        強度：中
      </p>
    </div>
  );
}