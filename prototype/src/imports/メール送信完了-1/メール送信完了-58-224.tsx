import svgPaths from "./svg-xzx7dehruf";

function Group() {
  return (
    <div className="absolute contents left-[calc(33.33%+112.33px)] top-[210px]">
      <div className="absolute left-[calc(33.33%+112.67px)] size-[108px] top-[211px]">
        <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 108 108">
          <circle cx="54" cy="54" fill="var(--fill-0, #D9D9D9)" id="Ellipse 1" r="54" />
        </svg>
      </div>
      <div className="absolute h-[55.35px] left-[calc(33.33%+135.62px)] overflow-clip top-[238px] w-[60.75px]" data-name="icon / tabler-icons / mail">
        <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
          <g id="Vector" />
        </svg>
        <div className="absolute inset-[20.83%_12.5%]" data-name="Vector">
          <div className="absolute inset-[-3.1%_-2.19%]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 47.5625 34.2875">
              <path d={svgPaths.p14188880} id="Vector" stroke="var(--stroke-0, #21272A)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </div>
        </div>
        <div className="absolute inset-[29.17%_12.5%_45.83%_12.5%]" data-name="Vector">
          <div className="absolute inset-[-7.23%_-2.2%]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 47.5628 15.8376">
              <path d={svgPaths.p2488300} id="Vector" stroke="var(--stroke-0, #21272A)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group1() {
  return (
    <div className="absolute contents left-[calc(33.33%+70.33px)] top-[486px]">
      <div className="absolute bg-white border border-[#8e8e93] border-solid h-[34px] left-[calc(33.33%+70.67px)] rounded-[3px] top-[487px] w-[192px]" />
      <p className="-translate-x-1/2 absolute decoration-solid font-['Noto_Sans:Medium','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+166.67px)] text-[#1c1c1e] text-[10px] text-center top-[497px] tracking-[0.8px] underline whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        メールが届かない場合は再送する
      </p>
    </div>
  );
}

export default function Component() {
  return (
    <div className="bg-white border border-black border-solid relative size-full" data-name="メール送信完了">
      <div className="absolute border border-[#696969] border-solid h-[798px] left-[-1px] top-[-1px] w-[1440px]" />
      <p className="absolute font-['Montserrat:ExtraBold',sans-serif] font-extrabold leading-[normal] left-[calc(33.33%+67.33px)] text-[#1c1c1e] text-[40px] top-[102px] tracking-[3.2px] whitespace-nowrap">TRAKON</p>
      <div className="absolute bg-[#d9d9d9] h-[40px] left-[-1px] top-[757px] w-[1000px]" />
      <p className="absolute font-['Noto_Sans:Medium',sans-serif] font-medium leading-[normal] left-[calc(33.33%+136.33px)] text-[11px] text-black top-[769px] tracking-[0.88px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        ©TRAKON
      </p>
      <Group />
      <div className="-translate-x-1/2 absolute font-['Noto_Sans:Medium','Noto_Sans_JP:Medium',sans-serif] font-medium leading-[0] left-[calc(33.33%+165.83px)] text-[#1c1c1e] text-[10px] text-center top-[353px] tracking-[0.8px] whitespace-nowrap" style={{ fontVariationSettings: "'CTGR' 0, 'wdth' 100" }}>
        <p className="leading-[normal] mb-0 whitespace-pre">メールを送信しました</p>
        <p className="leading-[normal] mb-0 whitespace-pre">you@example.com に</p>
        <p className="leading-[normal] mb-0 whitespace-pre">アカウント作成用のリンクを送りました。</p>
        <p className="leading-[normal] mb-0 whitespace-pre">メールに記載のリンクをクリックしてください。</p>
        <p className="leading-[normal] mb-0 whitespace-pre">​</p>
        <p className="leading-[normal] mb-0 whitespace-pre">メールが見つからない場合は</p>
        <p className="leading-[normal] whitespace-pre">迷惑メールフォルダもご確認ください。</p>
      </div>
      <Group1 />
    </div>
  );
}