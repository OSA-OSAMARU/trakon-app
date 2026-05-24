function Group() {
  return (
    <div className="absolute contents left-[calc(33.33%+6.33px)] top-[277px]">
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+6.67px)] text-[#1c1c1e] text-[14px] top-[278px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        メールアドレス
      </p>
      <div className="absolute bg-[#f5f5f5] border-[#8e8e93] border-[0.5px] border-solid h-[34px] left-[calc(33.33%+6.67px)] rounded-[5px] top-[304px] w-[321px]" />
    </div>
  );
}

function Group1() {
  return (
    <div className="absolute contents left-[calc(33.33%+79.33px)] top-[381px]">
      <div className="absolute bg-white border border-[#8e8e93] border-solid h-[34px] left-[calc(33.33%+79.67px)] rounded-[3px] top-[382px] w-[174px]" />
      <p className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium','Noto_Sans_Symbols:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+109.67px)] text-[#1c1c1e] text-[12px] top-[391px] tracking-[0.96px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        再設定メールを送る→
      </p>
    </div>
  );
}

export default function Component() {
  return (
    <div className="bg-white border border-black border-solid relative size-full" data-name="メールアドレス入力">
      <div className="absolute border border-[#696969] border-solid h-[798px] left-[-1px] top-[-1px] w-[1440px]" />
      <p className="absolute font-['Montserrat:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+68.33px)] text-[#1c1c1e] text-[40px] top-[102px] tracking-[3.2px] whitespace-nowrap">TRAKON</p>
      <div className="absolute bg-[#d9d9d9] h-[40px] left-[-1px] top-[757px] w-[1000px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+136.33px)] text-[11px] text-black top-[769px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ©TRAKON
      </p>
      <Group />
      <Group1 />
      <div className="absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium','Noto_Sans_JP:Regular',sans-serif] font-medium leading-[0] left-[calc(33.33%+1.33px)] text-[#1c1c1e] text-[0px] top-[185px] tracking-[1.12px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        <p className="leading-[normal] mb-0 text-[14px]">パスワードをお忘れですか？</p>
        <p className="font-['Noto_Sans:Regular','Noto_Sans_JP:Medium','Noto_Sans_JP:Regular',sans-serif] font-normal leading-[normal] mb-0 text-[14px]" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
          登録済みのメールアドレスを入力してください。
        </p>
        <p className="font-['Noto_Sans:Regular','Noto_Sans_JP:Medium','Noto_Sans_JP:Regular',sans-serif] font-normal leading-[normal] text-[14px]" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
          パスワード再設定用のリンクをお送りします。
        </p>
      </div>
      <p className="absolute decoration-solid font-['Noto_Sans:Regular','Noto_Sans_JP:Regular',sans-serif] font-normal leading-[normal] left-[calc(33.33%+108.33px)] text-[12px] text-black top-[446px] tracking-[0.96px] underline whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ログイン画面に戻る
      </p>
    </div>
  );
}