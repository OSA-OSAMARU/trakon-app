import { LegalDefList, LegalPageLayout } from './LegalPageLayout';
import { COMPANY, COMPANY_ADDRESS_FULL } from './companyInfo';

// 会社概要 — 出典 https://trakon-test.vercel.app/company。
// 所在地・電話番号は #112 で指定されたものを掲載する。
export function CompanyPage() {
  return (
    <LegalPageLayout title="会社概要">
      <LegalDefList
        rows={[
          { label: '会社名', value: COMPANY.name },
          { label: '代表取締役', value: COMPANY.representative },
          { label: '所在地', value: COMPANY_ADDRESS_FULL },
          { label: '電話番号', value: COMPANY.phone },
          {
            label: '事業内容',
            value: (
              <>
                {COMPANY.business.map((b) => (
                  <span key={b} className="block">
                    {b}
                  </span>
                ))}
              </>
            ),
          },
        ]}
      />
    </LegalPageLayout>
  );
}
