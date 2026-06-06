# CRM 系統 — 產品需求文件 (PRD)

> **版本**: Day 9
> **受眾**: 業務決策人 (Founder / Sales Lead / 客戶負責人)
> **目的**: 一份對齊現時系統狀態嘅產品需求文件,供新老闆快速理解我哋做緊乜、點解咁做、做到邊度

---

## 1. 一句話總結

一個專為 **B2B 銷售團隊** 設計嘅 CRM 系統,核心賣點係**報價單 (Quotation) 可以好快整**、**deal 嘅 stage 透明度高**、同埋**內置 AI 助手可以代你查嘢同草擬報價**。

---

## 2. 我哋點解要自己做一個 CRM

| 問題 | 現有方案 (Salesforce / HubSpot) 嘅痛點 | 我哋嘅做法 |
|---|---|---|
| **報價單工序慢** | 報價要 sales 喺 CRM 揀 product / service、再跳去 Excel 整 SOW、再 paste 入 PowerPoint、再 email | **Quotation Builder 同一個畫面搞掂晒**,Product / Service / SOW 一齊入,出 PDF 直接 send |
| **Deal 唔透明** | Sales 改咗 stage 老闆要逐個問,睇唔到 pipeline 實時狀況 | **Kanban 看板**,老闆一打開就見到每個 deal 卡喺邊個 stage、值幾多錢、邊個 sales 跟 |
| **AI Assistant 唔識公司 context** | 通用 ChatGPT 唔識你哋公司有咩 product、有咩 service、報價歷史 | **內置 AI Agent 讀齊公司 catalog + deal + quotation**,可以話「幫 ACME 開個 quotation 5 個 monitor + 2 個 installation」,AI 自動草擬 |

**我哋做嘅唔係另一個 Salesforce**,而係**為香港中小企 sales 團隊度身訂造**嘅工具 — **快、清楚、AI 識嘢**。

---

## 3. 目標用戶 (Persona)

### 3.1 主要用戶:Sales Rep (銷售員)

- **痛點**:每日要處理 5-10 個 deal,報價單工序繁複,跟進客戶時間唔夠
- **想要**:
  - 30 秒內起一個報價單
  - 一眼睇晒今日要做嘅 task
  - 唔使學新工具 (操作要直覺)
- **人數**:佔系統用戶 60%

### 3.2 次要用戶:Sales Manager / 老闆

- **痛點**:唔知 team pipeline 實時狀況,要逐個 sales 問
- **想要**:
  - 開電腦就見到 pipeline 看板
  - 見到 top customer 邊個,revenue trend
  - 唔使 sales 匯報都知 team 進度
- **人數**:佔系統用戶 30%

### 3.3 第三用戶:管理員 (Admin)

- **痛點**:管 user、設權限、稽核
- **想要**:簡單介面,唔使 technical background
- **人數**:佔系統用戶 10%

---

## 4. 核心功能 (四大支柱)

### 🧱 支柱一:客戶管理 (Customer Management)

**做咩**:管公司 + 公司嘅聯絡人 + 標籤 + 區域 (香港/澳門/中國/其他)

**解決咩問題**:Sales 唔再 excel 管客戶,所有資料集中,一搜即有

**Key features**:
- 公司卡片(industry / 統一商業登記 / 信用額度 / 付款條件)
- 每間公司可以有多個 contact (決策人、採購、IT)
- 地區分類 (Day 9 新加,之前係 hard-coded enum 而家係 table,將來加地區唔使改 code)
- Tag 自由標記(潛在客戶 / 策略夥伴 / 投訴客戶)

---

### 🧱 支柱二:目錄管理 (Catalogue)

**做咩**:管理兩種可以賣嘅嘢 — **Product** (實物 / 軟件) 同 **Service** (人天 / 顧問)

**解決咩問題**:Sales 報價前要問「我哋有冇呢個 product / service 賣?」「個價幾多?」— 而家一目了然

#### Product (產品目錄)

| 欄位 | 用途 |
|---|---|
| SKU | 產品編號 (e.g. `HW-MON-001`) |
| 名稱 / 描述 | 客戶睇嘅名同簡介 |
| 分類 | Hardware / Software / Subscription |
| 售價 / 成本 | 計 margin 用 |
| 庫存 | 可選擇性追蹤,設定低庫存警示 |
| 狀態 | ACTIVE / DRAFT / ARCHIVED |

#### Service (服務目錄) — **我哋嘅差異化**

每個 Service 包含一份 **SOW (Statement of Work) + 人天結構**:

| 例子:Installation Service | |
|---|---|
| 角色 | 日費 | 人天 | 小計 |
| Senior Consultant | $5,000 | 3 | $15,000 |
| Junior Engineer | $2,000 | 5 | $10,000 |
| **總價** | | **8 人天** | **$25,000** |

> **好處**:客戶唔淨止見到一個價,見到點樣計出嚟 — 透明度高,投訴少

---

### 🧱 支柱三:報價單 (Quotation Builder) ⭐ **核心賣點**

**做咩**:一個畫面整好成個報價單 — 揀 Product、揀 Service、計價、出 PDF

**解決咩問題**:傳統報價要 30-60 分鐘 (Excel + PowerPoint + Email 來回),我哋 **5-10 分鐘搞掂**

#### 報價單結構

```
Q-2026-0042
  客戶: ACME Limited
  標題: Q2 系統升級報價
  
  行項目:
    [PRODUCT] 27" 4K Monitor × 5 = $16,000
    [PRODUCT] HDMI Cable × 10 = $500
    [SERVICE] Installation Service × 1 = $25,000
        └── SOW: 包含人天明細
        └── 3 天 Senior Consultant
        └── 5 天 Junior Engineer
  
  小計: $41,500
  稅: 0%
  總計: $41,500
  有效期: 2026-08-31
  
  [儲存草稿]  [預覽]  [發送給客戶]
```

#### Polymorphic Line Items (差異化技術)

一行可以係 **Product** 或者 **Service** — 同一個畫面處理,後台自動 snapshot 客戶睇到嘅版本,即使日後個 service 改咗,**歷史報價單唔受影響**。

> 客戶收到嘅 PDF 永遠係當時嘅版本 — 唔會出現「個價同我當時睇嘅唔同」嘅爭議

#### 報價單生命週期

```
DRAFT  →  SENT  →  VIEWED  →  ACCEPTED
                    ↓
                  REJECTED
                    ↓
                  EXPIRED (過期)
                    ↓
                  INVOICED (已開發票)
```

每一次狀態改動都記低 timestamp (`sentAt`、`viewedAt`、`acceptedAt`),客戶睇過幾時都查得到。

---

### 🧱 支柱四:銷售管道 (Deal Pipeline) ⭐ **第二大賣點**

**做咩**:用 Kanban 看板管理所有進行中嘅商機,一眼睇晒

**解決咩問題**:Sales Manager 唔使逐個 sales 問,登入就見到邊個 deal 卡住咗

#### Kanban 看板

```
| Lead    | Qualified | Proposal  | Negotiation | Won    | Lost   |
|---------|-----------|-----------|-------------|--------|--------|
| Deal A  | Deal D    | Deal F    | Deal G      | Deal H | Deal I |
| Deal B  |           |           |             |        |        |
| Deal C  |           |           |             |        |        |
```

每張 card 顯示:
- Deal 名稱 + 客戶
- **金額** (e.g. $50,000 HKD)
- 負責 sales
- 預計成交日期
- 預設幾多個 quotation (badge)

**拖拽操作**:Sales 將 deal 從一個 stage 拉到下一個 stage,系統自動:
- 更新 `stage`
- 如果拉去 `Won` / `Lost`,自動 set `status` + `closedAt` + 問 sales 「點解贏/輸?」(儲存原因俾日後分析)
- 寫入 audit log (邊個 sales、幾時、改咗咩)

---

## 5. AI 助手 (Sales Copilot) — **第三大賣點**

**做咩**:內置 AI Agent,識齊公司 catalog + 客戶 + 報價歷史,sales 可以用對話方式查嘢或者叫 AI 草擬報價

### 5.1 解決咩問題

- 唔使逐個 product / customer 表格去查
- 老闆可以對話問:「今個月邊個 customer 最大?」 / 「ACME 嘅歷史報價?」
- Sales 可以對話叫 AI 開報價:「幫 ACME 開個 5 個 monitor + 1 個 installation」

### 5.2 AI 識做嘅 8 件事

| 你同 AI 講 | AI 會做 |
|---|---|
| 「ACME 嘅最近 quotation 點?」 | 搜公司 → 攞報價清單 → 摘要 |
| 「我哋有冇 HW-MON-001?」 | 搜 product catalog → 答你價錢同存量 |
| 「幫 ACME 開個 5 個 monitor + 1 個 installation」 | 自動解 company ID + product ID + 草擬報價單 ✅ |
| 「我同 Globex 嘅 Sarah 開咗個會」 | 寫 Activity Log (類型: Meeting) |
| 「邊個 customer 最大?」 | 計 revenue 排名 → Top 5 |
| 「今個季成交咗幾多?」 | 查 Won deals → 計 total |
| 「呢個 deal 風險點?」 | (規劃中) 分析 deal 歷史 → 評分 |
| 「我下個 step 應該做咩?」 | (規劃中) 建議 next best action |

### 5.3 報價單自動化 (舉個實例)

**Sales 輸入** (對話):
> 「幫 ACME 開個 5 個 HW-MON-001 同 1 個 SVC-INSTALL-001」

**AI 自動做**:
1. 搜公司 → 搵到 ACME Limited (id: `cm1234`)
2. 搜 product → 搵到 HW-MON-001 (id: `cm5678`, 價 $3,200)
3. 搜 service → 搵到 SVC-INSTALL-001 (id: `cm9012`, 價 $25,000 + 人天明細)
4. 草擬報價單 → 自動編號 `Q-2026-0042`,total $41,000
5. 回覆 sales:「Q-2026-0042 已經建立,你有 5 個 monitor + 1 個 installation 服務,total $41,000 HKD。要唔要預覽?」

**好處**:5-10 分鐘工序 → **30 秒**,零出錯 (AI 唔會打錯 SKU)

---

## 6. 系統支援嘅功能

呢部分係**支援性質**,唔係核心賣點但必要:

| 功能 | 描述 |
|---|---|
| **活動記錄 (Activity Log)** | Call / Email / Meeting / Note / Task 全部記低,日後客戶跟進唔使靠記性 |
| **任務管理** | 設 Task + 限期,系統提醒 |
| **角色權限 (RBAC)** | 3 個角色:管理員 (全權限) / 銷售 (日常) / 檢視者 (唯讀);自訂角色亦可 |
| **稽核日誌 (Audit Log)** | 每個改動都記低 (邊個、幾時、改咗咩),合規同除錯用 |
| **匯出 PDF** | 報價單可以出 PDF 直接 email 客戶 |

---

## 7. 咩係「第一階段」(MVP 範圍)

✅ **已經做好嘅核心範圍** (Day 1-9):

- [x] 公司 + 聯絡人管理
- [x] Product + Service 目錄
- [x] Quotation Builder (polymorphic line items)
- [x] Deal Kanban + 拖拽
- [x] AI 助手 (5 個 query tools + 草擬報價 + 寫活動記錄)
- [x] 3 個系統角色 + 自訂角色
- [x] 稽核日誌
- [x] PDF 匯出 (Day 9 規劃,基礎已備)

🚧 **未做 / 規劃中**:

- [ ] **報價單 + 客戶線上簽署** (e-sign integration)
- [ ] **Email 發送追蹤** (SendGrid / SES,追蹤客戶開咗未)
- [ ] **客戶自助 portal** (客戶可以自己睇報價、approve、付款)
- [ ] **AI next-best-action** (建議 sales 下一步做咩)
- [ ] **手機 App** (而家 responsive web,將來 native app)
- [ ] **與 ERP / 會計系統對接** (Xero / QuickBooks)
- [ ] **報價模板** (現成報價範本,改少少就出)
- [ ] **Slack / Teams 通知** (deal 變動推訊息)

---

## 8. 商業成效指標 (KPI)

我哋會追蹤呢啲數字去驗證產品有冇效:

### 8.1 用戶活躍度 (Adoption)

| 指標 | 目標 (上線 3 個月) |
|---|---|
| 日活躍用戶 (DAU) / 總用戶 | > 60% |
| 每個 sales 每日打開次數 | > 5 次 |
| 新用戶 7 日內建立第一個 deal | > 80% |

### 8.2 業務成效 (Business Impact)

| 指標 | 目標 |
|---|---|
| 報價單建立時間 (從 query 到 send) | 由 30 分鐘 → 10 分鐘 |
| 報價單 → 接受率 | > 25% |
| AI 助手使用率 (sales 每月用至少 1 次) | > 70% |
| 報價單錯誤率 (改咗價錢冇 update 等) | < 2% |

### 8.3 系統健康 (System Health)

| 指標 | 目標 |
|---|---|
| API uptime | > 99.5% |
| P95 page load | < 1.5 秒 |
| 零安全事故 (RBAC 漏洞、資料外洩) | 0 件 |

---

## 9. 競爭定位

| | **我哋 (CRM 系統)** | **Salesforce** | **HubSpot** |
|---|---|---|---|
| 學習曲線 | 1 小時上手 | 1 週訓練 | 2-3 日 |
| 報價單工序 | **5-10 分鐘 (AI 草擬)** | 30-60 分鐘 | 20-30 分鐘 |
| 月費 | 待定 (目標比 Salesforce 便宜 60%) | $75-300/user | $50-150/user |
| 中文 + 港式 workflow | ✅ 完整支援 | 部分 (translation) | 部分 |
| 內置 AI | ✅ 識公司 context | ⚠️ 需加購 Einstein ($) | ⚠️ 限制多 |
| 自訂角色 | ✅ 簡單 | ✅ 但要 admin cert | ⚠️ 高級 plan 才有 |
| 自家 hosting | ✅ 可 (將來 on-prem) | ❌ | ❌ |

**我哋嘅 sweet spot**:中小企 sales 團隊 (5-50 人)、想用 AI 但唔想俾 Salesforce 咁貴、講廣東話為主。

---

## 10. 風險與緩解

| 風險 | 影響 | 緩解策略 |
|---|---|---|
| AI hallucination 報錯 product / 價錢 | 報錯價,客戶投訴 | AI 必須先 search catalog 攞真實 data;後台要有「AI 草擬 → 必須人手 review → 然後 send」流程 |
| 銷售抗拒新系統 | 採用率低 | UI 跟住佢哋現有 Excel template 設計;onboarding 1 對 1 教;gamification (見到自己幾快完成報價有成就感) |
| OpenAI API 成本 | 太多 call 燒錢 | 設 daily quota per user;cache 常見 query;「lightweight」model option |
| 客戶資料私隱 | 合規問題 | RBAC 強制;audit log;將來 SOC2 / ISO27001 certification |
| 系統 downtime | Sales 報唔到價 | Cloudflare CDN cache 報價 PDF;status page;on-call rotation |

---

## 11. 路線圖 (Roadmap)

### 短期 (1-3 個月)
- 報價單 PDF 模板美化
- Email 整合 (SendGrid / AWS SES)
- 客戶活動追蹤 (邊個 client 開咗報價)
- Mobile RWD 強化

### 中期 (3-6 個月)
- 客戶自助 portal
- E-signature 整合
- Slack / Teams 通知
- 報價單模板

### 長期 (6-12 個月)
- AI next-best-action
- 與會計系統對接
- Native mobile app
- Multi-language (簡中 / 英文)

---

## 12. 預計成本結構 (給老闆睇)

| 項目 | 預計月費 |
|---|---|
| **開發團隊** | 待定 |
| **雲端基建 (AWS / Cloudflare)** | ~$200-500 (初版,小流量) |
| **OpenAI API** (AI Agent) | ~$100-300 (視乎用量) |
| **其他服務** (Email / SMS / E-sign) | ~$50-100 |
| **合計** | **~$350-900 / 月** (上線初期) |

> 客戶月費定價未決定 — 視乎市場反應 + 競爭對手定價

---

## 13. 老闆常見問題 FAQ

**Q: 點解唔用現成嘅 Salesforce / HubSpot?**
A: 我哋唔係要做另一個 Salesforce。我哋做嘅係**專為香港中小企、報價工序 AI 化**嘅輕量工具。Salesforce 太重、太貴、廣東話 workflow 唔 friendly。HubSpot 限制多。

**Q: AI 助手會唔會亂答?**
A: AI 唔係自己作 data,**一定要先 search 公司 catalog / 客戶 records** 先回答。報價單草擬後**人手 review 過先可以 send**。我哋將「AI 草擬 → 人手審核」設為強制流程,避免 AI hallucination 出街。

**Q: 客戶唔用我哋 system 點算?佢哋睇唔到報價單。**
A: 報價單會出 **PDF 直接 email 客戶**,客戶唔需要裝任何嘢。將來會有客戶自助 portal,但第一階段以 email + PDF 為主。

**Q: 個 system 安全嗎?客戶資料會唔會洩漏?**
A: 三重保護:
1. **RBAC** — 唔同角色睇唔同資料
2. **Audit log** — 每個查詢 / 修改都記低
3. **HTTPS + JWT** — 業界標準加密

**Q: 點解我哋用 PostgreSQL?唔用 MongoDB?**
A: CRM 係**關聯性強**嘅 data(客戶有 contact, contact 有 address, deal 有 quotation, quotation 有 line items),PostgreSQL 嘅 relational model 最適合。MongoDB 喺呢個場景會好慢、容易 inconsistent。

**Q: 如果客戶想 self-host 點算?**
A: 我哋整個 stack 係 Docker Compose,理論上可以 on-prem。但第一階段先做 SaaS,將來自訂需求先講。

**Q: 點解用 React + Vite?唔用 Next.js?**
A: 個系統係 **SPA (Single Page App)**,全部互動喺 browser 做,Vite + React 19 開發速度最快、bundle 最小。Next.js 適合 SEO-heavy 嘅 public site,呢個係後台工具,唔需要 SEO。

**Q: 個 system 將來可以加嘢嗎?**
A: 架構係 modular,加新功能 (例如 invoice、subscription) 都係加一個 route + page。Backend 嘅 RBAC + audit log 都係 plug-in 模式,新功能自動受惠。
