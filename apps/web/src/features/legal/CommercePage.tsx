import { LegalDefList, LegalPageLayout } from './LegalPageLayout';

// 特定商取引法に基づく表記 — 出典 https://trakon-test.vercel.app/commerce.html の本文をそのまま掲載。
export function CommercePage() {
  return (
    <LegalPageLayout title="特定商取引法に基づく表記">
      <LegalDefList
        rows={[
          { label: '販売事業者', value: '株式会社おさまるカンパニー' },
          { label: '運営責任者', value: '宮丸 長（Osa MIYAMARU）' },
          { label: '所在地', value: '埼玉県児玉郡神川町原新田21-20' },
          {
            label: 'お問い合わせ先',
            value: (
              <>
                お問い合わせフォームよりご連絡ください。
                <br />
                ※メールによるお問い合わせは、
                <a
                  href="mailto:trakon_contact@osamaru.com"
                  className="text-foreground underline underline-offset-2"
                >
                  trakon_contact@osamaru.com
                </a>{' '}
                でも受け付けています。
              </>
            ),
          },
          { label: '電話番号', value: '請求があった場合、遅滞なく開示いたします。' },
          {
            label: '販売価格',
            value: '各プランごとに、申込ページまたは料金ページに表示する金額とします。',
          },
          {
            label: '商品代金以外の必要料金',
            value: 'インターネット接続に必要な通信料等は、お客様のご負担となります。',
          },
          { label: '支払方法', value: 'クレジットカード決済その他、当社が別途定める方法' },
          {
            label: '支払時期',
            value:
              '有料プランの申込時に初回決済を行います。以後、月額プランは申込日を基準として1か月ごとに、年額プランは申込日を基準として1年ごとに課金されます。',
          },
          {
            label: '役務の提供時期',
            value:
              '決済完了後、直ちに利用を開始できます。ただし、当社が別途開始日を定めた場合は、その日から利用できるものとします。',
          },
          {
            label: '契約期間',
            value:
              '月額プランは1か月ごと、年額プランは1年ごとの契約です。契約者が次回更新日の前日までに所定の方法で解約しない限り、同一条件で自動更新されます。',
          },
          {
            label: '解約について',
            value:
              '契約者は、次回更新日の前日までに所定の方法で解約手続を行うことで、次回以降の更新を停止できます。解約後も、契約期間の満了日までは本サービスを利用できます。',
          },
          {
            label: '返品・キャンセル・返金について',
            value:
              '本サービスの性質上、契約成立後の返品はできません。契約期間の途中で解約した場合であっても、法令上義務がある場合を除き、支払済みの利用料金の返金および日割精算は行いません。',
          },
          {
            label: '動作環境',
            value:
              '最新版の Google Chrome、Microsoft Edge、Apple Safari、Mozilla Firefox での利用を推奨します。一部のブラウザ、端末または利用環境では、表示や機能に制限が生じる場合があります。',
          },
          {
            label: '特別条件',
            value:
              '無料プラン、キャンペーン、割引その他特別条件が適用される場合は、申込ページ、料金ページまたはキャンペーンページ等に別途表示します。キャンペーン価格その他の特別条件が適用される場合でも、更新後は通常料金が適用されることがあります。その場合の適用条件、適用期間、更新後の料金その他の条件は、申込時または対象ページに表示します。',
          },
        ]}
      />
    </LegalPageLayout>
  );
}
