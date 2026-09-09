# AI Trading Prediction Tool — Spec v2

> Phiên bản 2, viết lại từ spec gốc (`AI_Trading_Prediction_Tool_Spec-1-553f44.docx`).
> Mục tiêu: một hệ thống dự đoán vận hành như một **đội phân tích thị trường chuyên nghiệp** — có quy trình, có kiểm chứng, có trách nhiệm giải trình — chứ không phải một "hộp đen ra tín hiệu".

---

## 0. Nguyên tắc thiết kế (bất biến)

1. **Mọi output là xác suất đã calibrate**, không bao giờ là tín hiệu chắc chắn.
2. **Không có label định nghĩa rõ thì không có model.** Mọi model phải khai báo label + horizon trước khi train.
3. **Backtest đẹp không có giá trị nếu có leakage.** Mọi pipeline phải chứng minh point-in-time.
4. **Mỗi thành phần mới phải chứng minh cải thiện đo được** (Brier/Sharpe out-of-sample) trước khi được giữ lại.
5. **Risk layer có quyền phủ quyết tuyệt đối** đối với mọi khuyến nghị của tầng dự đoán.
6. **Tái lập được (reproducible):** mọi dự đoán phải truy ngược được về phiên bản model, phiên bản dữ liệu, và feature snapshot đã tạo ra nó.

---

## 1. Định nghĩa Label & Horizon (MỚI — bắt buộc trước mọi thứ khác)

### 1.1 Phương pháp: Triple-Barrier (López de Prado)

Với mỗi nến tại thời điểm `t` trên khung `TF`:

- **Barrier trên:** `close_t + k_up × ATR(14)_t`
- **Barrier dưới:** `close_t − k_dn × ATR(14)_t`
- **Barrier thời gian:** `N` nến

Label:
- `1` (tăng) nếu chạm barrier trên trước
- `0` (giảm) nếu chạm barrier dưới trước
- **Loại khỏi tập train** nếu chạm barrier thời gian mà chưa chạm barrier giá (vùng trung tính — không ép model học nhiễu)

### 1.2 Tham số theo khung

| Khung | N (nến) | k_up / k_dn | Ghi chú |
|---|---|---|---|
| 15m | 16 | 1.0 / 1.0 | Chỉ dùng ở Phase 3+ |
| 1H | 12 | 1.2 / 1.2 | |
| 4H | 10 | 1.5 / 1.5 | Khung chính Phase 1 |
| 1D | 7 | 2.0 / 2.0 | Khung chính Phase 1 |
| 1W | 6 | 2.5 / 2.5 | Chỉ phân tích bối cảnh, không trade |

- `k_up ≠ k_dn` được phép khi tối ưu cho chiến lược bất đối xứng, nhưng phải khai báo và cố định trước khi train.
- Mọi metric (accuracy, Brier, calibration) chỉ so sánh được giữa các model **cùng label definition**.

---

## 2. Kiến trúc Model — Interface chuẩn hóa

### 2.1 Interface bắt buộc cho mọi model con

```
ModelOutput {
  prob_up: float          // xác suất đã calibrate, theo label definition mục 1
  confidence: float       // 0–1, chất lượng nội tại của dự đoán này
  invalidation_price: float | null   // mức giá phủ nhận luận điểm (bắt buộc với E, F)
  features_hash: string   // hash của feature snapshot (reproducibility)
  model_version: string
  data_asof: timestamp    // thời điểm dữ liệu mới nhất được dùng
}
```

### 2.2 Sáu model con

| Model | Nguồn chính | Cách ra prob_up |
|---|---|---|
| A — Technical | OHLCV + indicator | Gradient boosting trên feature kỹ thuật |
| B — Order Flow | Orderbook, CVD, liquidation | Deep model (LSTM/Transformer); giải thích bằng attention weights hoặc integrated gradients, KHÔNG dùng SHAP cho deep model |
| C — On-chain / Vĩ mô | On-chain, funding, OI, DXY, yields | Gradient boosting, feature phân tầng theo tần suất cập nhật (mục 3.4) |
| D — Sentiment/News | News feed point-in-time, social | NLP scoring → prob, tuân thủ quy tắc timestamp (mục 4.2) |
| E — Elliott Wave | Swing structure (ZigZag định lượng) | `prob_up = f(tỷ lệ tuân thủ rule, khoảng cách tới invalidation)`; wave count chỉ hợp lệ khi ZigZag threshold lọc được ≥ 5 swing hợp lệ — bỏ tiêu chí chủ quan "nếu rõ" |
| F — Price Action | S/R, cấu trúc nến, entry zone | Bias + zone chuyển thành prob qua logistic mapping đã fit trên lịch sử |

### 2.3 Meta-model (stacking)

- Nhận **đủ 6 input** theo interface 2.1 + regime vector (mục 5) + confluence scores (mục 2.4).
- Train **chỉ trên out-of-fold predictions** với **purged k-fold + embargo ≥ horizon N** của label (chống leakage — xem mục 4.1).
- Trọng số động theo hiệu suất trượt (rolling Brier) áp dụng cho **cả 6 model**, kể cả E/F.
- **Gate:** meta-model phải thắng model con tốt nhất trên out-of-sample. Nếu không thắng → dùng model đơn tốt nhất, không thêm phức tạp.

### 2.4 Confluence Layer — củng cố tín hiệu Price Action (MỚI)

> Mô phỏng cách một desk chuyên nghiệp xác nhận setup nến: một tín hiệu Price Action chỉ đáng tin khi các nguồn bằng chứng **độc lập** cùng chỉ về một hướng. Lớp này nằm **giữa** 6 model con và meta-model — không thay thế phân tích độc lập, chỉ bổ sung feature hội tụ.

**Hai nhóm hội tụ (confluence groups):**

| Nhóm | Thành viên | Mục đích |
|---|---|---|
| **CG-1: Xác nhận dòng tiền** | B (Order Flow) + C (On-chain) + F (Price Action) | Setup nến tại S/R chỉ được củng cố khi dòng lệnh (CVD, orderbook) và dòng tiền on-chain xác nhận cùng hướng — trả lời câu hỏi "có tiền thật đứng sau cây nến này không?" |
| **CG-2: Xác nhận cấu trúc** | B (Order Flow) + C (On-chain) + E (Elliott) + F (Price Action) | Setup nến được củng cố khi vừa có dòng tiền, vừa khớp vị trí trong cấu trúc sóng (ví dụ: pin bar tại vùng kết thúc sóng 2/sóng 4) — trả lời "cây nến này nằm đúng chỗ trong bức tranh lớn không?" |
| **CG-3: Xác nhận breakout** | A (Technical) + B (Order Flow) + F (Price Action) | Breakout khỏi S/R chỉ được củng cố khi momentum kỹ thuật VÀ delta/volume dòng lệnh cùng xác nhận — trả lời "breakout thật hay fake breakout?" Đây là bộ lọc fake breakout trực tiếp nhất |
| **CG-4: Đảo chiều contrarian** | A (Technical divergence) + C (funding/OI) + D (Sentiment) | Kích hoạt khi sentiment cực đoan (Fear/Greed đỉnh) + funding lệch nặng + phân kỳ momentum — trả lời "đám đông đã nghiêng hết về một phía chưa?" Tín hiệu NGƯỢC hướng đám đông, chỉ dùng ở khung 4H trở lên |
| **CG-5: Smart money vs đám đông** | C (On-chain) + D (Sentiment) | Đo độ lệch giữa hành vi ví lớn/dòng tiền sàn và tâm lý đám đông — khi whale gom mà đám đông sợ hãi (hoặc ngược lại), độ lệch là feature dự báo. Nhóm 2 thành viên nên chỉ dùng làm feature phụ, không có proximity_bonus |
| **CG-6: Săn thanh khoản (squeeze)** | B (liquidation map, OI) + C (funding) + F (S/R zone) | Kích hoạt khi cụm thanh lý lớn nằm ngay sau S/R gần entry zone + funding/OI căng — trả lời "giá có động cơ bị kéo tới vùng thanh lý trước khi đi đúng hướng không?" Dùng để dịch stop ra ngoài vùng săn stop, không phải để mở lệnh |

**Cách tính confluence score (mỗi nhóm):**

```
confluence_score = agreement(nhóm) × min_confidence(nhóm) × proximity_bonus
```

- `agreement`: mức đồng hướng của prob_up các thành viên (1 = tất cả cùng phía, 0 = chia đôi). Dùng khoảng cách tới 0.5, không dùng vote nhị phân.
- `min_confidence`: confidence thấp nhất trong nhóm — hội tụ chỉ mạnh bằng mắt xích yếu nhất. Một thành viên có dữ liệu degraded (3.1) kéo cả nhóm xuống.
- `proximity_bonus`: chỉ kích hoạt khi giá đang trong entry zone của Model F **và** (với CG-2) khoảng cách tới invalidation của E còn đủ xa (≥ 1 ATR). Ngoài zone → score = 0, không có "hội tụ từ xa". Áp dụng cho các nhóm có F (CG-1, CG-2, CG-3, CG-6); nhóm không gắn với setup nến cụ thể (CG-4, CG-5) bỏ hệ số này.
- Với **CG-4** (contrarian): `agreement` được tính theo hướng NGƯỢC của D — sentiment cực đoan một phía + phân kỳ momentum + funding lệch cùng phía đám đông mới cho score cao.
- Với **CG-6** (squeeze): output không phải hướng lệnh mà là `squeeze_risk ∈ [0,1]` + vùng thanh lý gần nhất — risk layer dùng để đặt stop ra ngoài vùng săn stop.

**Quy tắc sử dụng:**

1. Confluence scores (CG-1 → CG-6) là **feature bổ sung cho meta-model** — meta-model tự học trọng số của chúng, không hard-code "hội tụ thì vào lệnh". Riêng CG-6 đi thẳng vào risk layer (đặt stop), không vào meta-model.
2. **Chống đếm trùng (double-counting):** B, C, F xuất hiện trong cả hai nhóm — meta-model đã nhận prob_up gốc của từng model, nên confluence score phải được kiểm tra tương quan; nếu tương quan với input gốc > 0.9 thì score đó không thêm thông tin và bị loại theo quy tắc vàng (mục 9).
3. **Hội tụ nghịch là tín hiệu chặn:** khi F cho setup đẹp nhưng CG-1 cho score gần 0 (dòng tiền đi ngược cây nến), decision engine phải ghi cảnh báo "price action không được dòng tiền xác nhận" vào decision log — đây là chính xác trường hợp bull trap / fake breakout mà lớp này sinh ra để bắt.
4. Confluence layer chỉ được bật từ **Phase 4** (khi đã có đủ B, C, E, F) và phải qua gate 8.5 như mọi thành phần khác: có nó phải thắng không có nó trên out-of-sample.
5. Point-in-time như mọi feature khác: thành viên nào có `data_asof` cũ hơn nến hiện tại quá ngưỡng → nhóm bị đánh dấu degraded.

---

## 3. Dữ liệu

### 3.1 Data Source Registry (MỚI — thay danh sách rời rạc)

| Nguồn | API | Tần suất | Độ trễ chấp nhận | Fallback | Dùng cho |
|---|---|---|---|---|---|
| OHLCV | Sàn chính (REST+WS) | realtime | 2s | Sàn thứ 2 | A, E, F |
| Orderbook/Trades | Sàn chính (WS) | realtime | 1s | Snapshot REST | B |
| Funding/OI | Sàn chính | 1m | 30s | Aggregator | C |
| Liquidation map | Nhà cung cấp cụ thể (phải chốt trước Phase 2) | 5m | 2m | Bỏ feature | B |
| On-chain | Provider on-chain | 10m–1h | 10m | Cache cũ + hạ confidence | C |
| News feed | Feed có timestamp nhận thực tế | realtime | 30s | Bỏ feature phiên đó | D |
| Fear & Greed | 1 lần/ngày | 1d | — | Cache | C (chỉ khung ≥ 4H) |
| Lịch kinh tế (MỚI) | Economic calendar API | 1h | — | Nhập tay | Risk layer, mục 6.4 |

- **Quy tắc:** nguồn không có trong registry thì không được xuất hiện trong feature. Polymarket bị loại khỏi spec cho đến khi có dòng registry đầy đủ.
- Mỗi nguồn có **data quality score**; nguồn dưới ngưỡng → feature bị đánh dấu degraded → confidence cuối tự giảm (mục 7).

### 3.2 Point-in-time (chống look-ahead)

- Mọi feature chỉ dùng dữ liệu có `timestamp ≤ close time của nến`.
- News: lưu **raw feed kèm thời điểm nhận thực tế**; cấm dùng dataset đã chỉnh sửa hồi tố.
- Dữ liệu revised (on-chain thường bị sửa lại) phải lưu cả bản gốc lẫn bản sửa, backtest chỉ dùng bản gốc tại thời điểm đó.

### 3.3 Feature Store (MỚI)

- Feature được tính một lần, version hóa, lưu tập trung — train và inference dùng **cùng một code path** (chống training/serving skew).
- Mỗi dự đoán lưu `features_hash` để tái lập.

### 3.4 Phân tầng feature theo tần suất

- Feature cập nhật chậm (F&G, on-chain daily) **không được dùng** cho khung nhanh hơn tần suất của nó.
- Mỗi feature khai báo `min_timeframe`.

---

## 4. Chống Leakage & Backtest

### 4.1 Quy tắc train

- **Purged k-fold với embargo ≥ N** (horizon label) cho stacking.
- Walk-forward cho đánh giá cuối: train window trượt, không bao giờ nhìn tương lai.
- Không tune hyperparameter trên tập test cuối. Tập test cuối chỉ chạm **một lần** trước khi lên production.

### 4.2 Backtest phải mô phỏng chi phí thật (MỚI)

Đội chuyên nghiệp không bao giờ tin backtest không phí. Bắt buộc mô hình hóa:

- **Phí giao dịch** (maker/taker thực tế của sàn)
- **Slippage:** ước lượng theo độ sâu orderbook lịch sử; tối thiểu dùng mô hình `slippage = f(size, spread, volatility)`
- **Funding cost** cho vị thế perpetual giữ qua kỳ funding
- **Latency:** giả định khớp lệnh ở nến tiếp theo, không bao giờ khớp tại giá close của nến tín hiệu

**Gate:** chiến lược phải dương **sau chi phí**. Sharpe trước phí không có giá trị phê duyệt.

### 4.3 Kiểm tra robustness (MỚI)

- **Monte Carlo trên thứ tự trade** (shuffle) → phân phối drawdown, không chỉ một con số.
- **Parameter sensitivity:** kết quả phải ổn định trong vùng lân cận tham s�����; chiến lược chỉ tốt tại một điểm tham số = overfit, loại.
- **Regime slicing:** báo cáo hiệu suất riêng theo từng regime (mục 5) — chiến lược chỉ thắng trong 1 regime phải bị gắn nhãn và chỉ được bật trong regime đó.

---

## 5. Regime Detection (MỚI — cách đội chuyên nghiệp nhìn thị trường)

Nhà phân tích giỏi luôn hỏi "thị trường đang ở chế độ nào?" trước khi hỏi "lên hay xuống?".

- **Regime classifier** chạy trước mọi model: `{trending-up, trending-down, ranging, high-volatility/crisis}` — dùng HMM hoặc clustering trên realized vol + trend strength + correlation.
- Regime vector là **input của meta-model** và của risk layer.
- Trọng số model theo regime: ví dụ Model A/E mạnh khi trending, Model B/F mạnh khi ranging — trọng số học từ dữ liệu, không gán tay.
- Regime `crisis` → tự động vào chế độ phòng thủ: giảm size, tăng ngưỡng confidence, có thể chỉ cho phép đóng vị thế.

---

## 6. Risk Layer (quy tắc cứng, có quyền phủ quyết)

### 6.1 Position sizing

- **Fractional Kelly ≤ 0.25**, tính trên xác suất đã calibrate.
- Cap cứng: size một vị thế ≤ X% equity (mặc định 2%); tổng exposure đồng thời ≤ Y% (mặc định 6%).
- Quantity/price luôn validate server-side.

### 6.2 Ngưỡng vào lệnh

- `confidence < ngưỡng` → **không vào lệnh** (không phải "giảm size 30%" như spec cũ).
- Ngưỡng theo regime: crisis đòi confidence cao hơn.

### 6.3 Circuit breaker

- Daily loss limit → dừng trade trong ngày.
- Chuỗi thua liên tiếp vượt ngưỡng thống kê (so với phân phối Monte Carlo 4.3) → dừng và trigger review (mục 9).
- Brier score trượt quá ngưỡng drift → model bị hạ trọng số về 0 cho tới khi retrain đạt gate.

### 6.4 Event calendar awareness (MỚI)

- Trước sự kiện vĩ mô lớn (FOMC, CPI, ETF decision...): tự động giảm size hoặc cấm vào lệnh trong cửa sổ ±T quanh sự kiện, theo cấu hình.
- Đây là hành vi chuẩn của trading desk chuyên nghiệp mà spec cũ hoàn toàn thiếu.

### 6.5 Red Team veto

- Red Team là **một rule trong risk layer** (không nằm ngoài): nếu Red Team đưa ra counter-thesis với bằng chứng đạt ngưỡng, lệnh bị chặn hoặc size bị cắt, và cả hai luận điểm được ghi vào decision log.

---

## 7. Confidence — một công thức duy nhất

```
confidence_final = w1 × agreement          // đồng thuận (entropy thấp)
                 + w2 × calibration_recent // rolling Brier từng model
                 + w3 × data_quality       // từ registry 3.1
                 + w4 × regime_fit         // model có track record trong regime hiện tại không
```

- Trọng số `w` fit trên lịch sử, không gán tay.
- **Disagreement là thông tin:** khi các model chia phe mạnh (entropy cao), hệ thống xuất "no-trade / conflicting evidence" kèm luận điểm hai phía — giống một cuộc họp đội phân tích bất đồng, thay vì ép ra một con số trung bình vô nghĩa.

---

## 8. Vận hành như một đội chuyên nghiệp

### 8.1 Ba vai trò AI (giữ từ spec cũ, làm rõ trách nhiệm)

- **Analyst:** tổng hợp 6 model → thesis chính, kèm invalidation.
- **Red Team:** độc lập, chỉ được truy cập cùng dữ liệu point-in-time, nhiệm vụ duy nhất là bẻ thesis.
- **Risk Manager:** áp mục 6, quyền phủ quyết cuối.

### 8.2 Decision log mở rộng

Mỗi quyết định lưu: thesis + counter-thesis, prob/confidence từng model, regime, features_hash, model_version, hành động cuối, và **lý do nếu bị veto**.

### 8.3 Post-mortem loop (MỚI)

- Hàng tuần: tự động sinh báo cáo "dự đoán sai lớn nhất" — model nào sai, trong regime nào, feature nào dẫn dắt.
- Kết quả post-mortem là input cho quyết định retrain/hạ trọng số. Đây là cơ chế học từ sai lầm — thứ phân biệt đội chuyên nghiệp với hệ thống tĩnh.

### 8.4 Retrain policy

- Theo lịch: khung nhỏ retrain thường xuyên hơn (15m/1H: hàng tuần; 4H/1D: hàng tháng).
- Theo trigger: drift Brier vượt ngưỡng → retrain ngay, nhưng model mới vẫn phải qua gate mục 8.5.

### 8.5 Acceptance gates (mỗi model, mỗi l��n retrain)

1. Brier score < baseline (dự đoán tần suất lịch sử của label)
2. Calibration error (ECE) < 5%
3. Không suy giảm > X% trên bất kỳ regime slice nào
4. Meta-model: phải thắng model con tốt nhất out-of-sample
5. Chiến lược end-to-end: dương sau chi phí (mục 4.2)

### 8.6 Paper trading bắt buộc (MỚI)

- Mọi model/phiên bản mới chạy **paper trading tối thiểu 4 tuần** (hoặc ≥ 100 tín hiệu) trên dữ liệu live trước khi được tính là production.
- So sánh live vs backtest: nếu hiệu suất live lệch quá 2 độ lệch chuẩn so với kỳ vọng backtest → chặn, điều tra leakage/skew.

### 8.7 Monitoring & observability (MỚI)

- Dashboard theo dõi realtime: rolling Brier per model, calibration curve, data quality per source, feature drift (PSI), latency pipeline.
- Alert khi bất kỳ chỉ số nào vượt ngưỡng — không đợi báo cáo tuần.

---

## 9. Phased Delivery

| Phase | Nội dung | Gate để sang phase sau |
|---|---|---|
| **1** | Model A + label definition + walk-forward + calibration + decision log + risk layer cơ bản. 1 cặp (BTC/USDT), 2 khung (4H, 1D) | Qua gates 8.5, xong 4 tuần paper trading |
| **2** | + Model B, meta-model 2 input, regime detection, backtest có chi phí đầy đủ | Meta thắng A đơn lẻ out-of-sample, sau chi phí |
| **3** | + Model C, D; event calendar; monitoring dashboard | Mỗi model mới cải thiện Brier/Sharpe đo được |
| **4** | + Model E, F (interface 2.1); **Confluence Layer (2.4)**; Red Team + post-mortem loop; thêm cặp/khung | Như trên; confluence phải thắng phiên bản không có nó out-of-sample |
| **5** | Multi-asset, khung 15m, tối ưu execution | Ổn định ≥ 1 quý ở Phase 4 |

**Quy tắc vàng:** thành phần nào không chứng minh được cải thiện đo được thì bị gỡ, bất kể đã tốn bao nhiêu công xây.

---

## 10. Yêu cầu kỹ thuật cho app

- **Reproducibility:** model registry (version, data range, hyperparams, git commit); mọi prediction truy ngược được.
- **Kiến trúc:** ingestion → feature store → model serving → decision engine (Analyst/RedTeam/Risk) → execution/paper → logging. Mỗi tầng thay được độc lập.
- **UI tối thiểu (khi xây app):** dashboard xác suất + confidence + regime + invalidation; decision log có tìm kiếm; trang monitoring (8.7); KHÔNG có nút "auto-trade" cho tới hết Phase 4.
- **Disclaimer:** output là công cụ hỗ trợ phân tích, không phải lời khuyên đầu tư.

---

## 11. Quy trình phát triển Test-Gated (MỚI — bắt buộc khi giao cho AI/dev coding)

> Nguyên tắc: **mỗi file tạo ra phải có test đi kèm và test phải PASS thì mới được viết file tiếp theo.** Không có ngoại lệ. Đây là cơ chế duy nhất đảm bảo chất lượng khi toàn bộ code được viết bởi AI hoặc dev thuê ngoài.

### 11.1 Vòng lặp bắt buộc cho MỖI file

```
1. Khai báo: file sắp viết làm gì, input/output, edge cases (3–5 dòng)
2. Viết test TRƯỚC (test file đặt cạnh: src/foo.py → tests/test_foo.py)
3. Viết code cho tới khi test pass
4. Chạy TOÀN BỘ test suite (không chỉ test của file mới) — tất cả phải pass
5. Chỉ khi bước 4 xanh mới được bắt đầu file tiếp theo
```

- Nếu test của file mới làm hỏng test cũ → sửa ngay trong cùng bước, không được "để sau".
- Cấm viết nhiều file cùng lúc rồi test gộp. Một file — một vòng lặp.
- Cấm sửa test cho khớp với code sai. Muốn đổi hành vi thì đổi khai báo ở bước 1 trước, ghi lý do vào commit message.

### 11.2 Yêu cầu test tối thiểu theo tầng

| Tầng | Loại test bắt buộc | Ví dụ cụ thể |
|---|---|---|
| Data ingestion | Unit + contract test | Parse đúng schema từng nguồn trong registry 3.1; reject dữ liệu thiếu timestamp; test với response lỗi/rỗng của API |
| Feature store | Unit + **point-in-time test** | Với mỗi feature: assert không có giá trị nào dùng dữ liệu sau `close time` của nến (test leakage tự động, không dựa vào review tay) |
| Label (mục 1) | Unit trên fixture | Fixture nến dựng tay có đáp án biết trước: chạm barrier trên → label 1; chạm thời gian → bị loại; k_up ≠ k_dn hoạt động đúng |
| Model con | Interface + sanity test | Output đúng schema 2.1; `prob_up ∈ [0,1]`; cùng input + cùng seed → cùng output (determinism); train trên dữ liệu ngẫu nhiên → Brier ≈ baseline (model không "học" được từ nhiễu = không leak) |
| Meta-model | Leakage test | Assert embargo ≥ N được áp; out-of-fold predictions không trùng index với fold train |
| Confluence layer (2.4) | Unit + correlation test | Fixture 4 model output: tất cả đồng hướng → score cao; chia phe → score ≈ 0; ngoài entry zone → score = 0; thành viên degraded kéo min_confidence xuống; test tương quan score vs input gốc < 0.9 |
| Risk layer | Unit — **coverage 100%** | Từng rule mục 6: Kelly cap, ngưỡng confidence, circuit breaker, event window, veto. Mỗi rule tối thiểu 1 test pass + 1 test chặn |
| Backtest engine | Golden test | Chiến lược buy-and-hold trên fixture giá biết trước → equity curve khớp đáp án tính tay (cả phí, slippage, funding) |
| Decision engine | Integration test | Pipeline giả lập end-to-end trên fixture: 6 model output → meta → risk → quyết định cuối khớp kỳ vọng |
| API/UI | Route + component test | Mỗi route handler có test status code + schema response; component chính có render test |

### 11.3 Fixtures — dữ liệu test cố định

- Tạo thư mục `tests/fixtures/` NGAY từ file đầu tiên: chuỗi nến OHLCV nhỏ (~200 nến) dựng tay hoặc cắt từ lịch sử, **commit vào repo**, có file đáp án (label, ATR, equity curve kỳ vọng) tính sẵn.
- Test KHÔNG BAO GIỜ gọi API thật — mọi nguồn dữ liệu đều mock từ fixture. Test phải chạy được offline và cho cùng kết quả ở mọi máy.
- Model test dùng seed cố định. Test có yếu tố ngẫu nhiên không seed = test không hợp lệ.

### 11.4 Định nghĩa "PASS" (Definition of Done cho một file)

Một file chỉ được coi là xong khi **tất cả** điều sau đúng:

1. Test riêng của file pass
2. Toàn bộ test suite pass (không regression)
3. Coverage của file mới ≥ 80% dòng (risk layer: 100%)
4. Lint + type check sạch (mypy/pyright cho Python, tsc cho TypeScript)
5. Không có test nào bị skip/comment-out mà không có ghi chú lý do + ticket

### 11.5 Thứ tự viết file trong Phase 1 (lộ trình test-gated cụ thể)

Người code phải đi đúng thứ tự này — mỗi dòng là một vòng lặp 11.1 hoàn chỉnh:

1. `tests/fixtures/` — dữ liệu nến mẫu + file đáp án (tự thân nó cũng cần script kiểm tra tính toàn vẹn)
2. `data/schemas` — schema OHLCV, kiểm tra bằng contract test
3. `features/atr` — ATR(14), test khớp đáp án fixture
4. `labels/triple_barrier` — mục 1, test đủ 3 nhánh barrier
5. `features/technical` — feature Model A, mỗi feature một test point-in-time
6. `models/model_a` — train/predict, test interface 2.1 + determinism + random-data sanity
7. `calibration` — Platt/isotonic, test ECE giảm trên fixture
8. `backtest/engine` — golden test buy-and-hold
9. `backtest/costs` — phí/slippage/funding, test khớp tính tay
10. `risk/rules` — coverage 100%
11. `decision/engine` — integration test end-to-end
12. `logging/decision_log` — test ghi/đọc/truy vấn
13. API routes + UI — route test + render test

### 11.6 CI như một gate cứng

- Mọi commit chạy: full test suite + lint + type check + coverage report.
- CI đỏ → cấm merge, cấm viết tiếp file mới trên nhánh đó.
- Báo cáo bàn giao mỗi file gồm: tên file, test đi kèm, kết quả chạy suite (số test pass/tổng), coverage %. Không có báo cáo = file chưa xong.

---

## Phụ lục A — Những gì bị loại khỏi spec cũ và lý do

| Mục cũ | Lý do loại/sửa |
|---|---|
| "Giảm size 30% khi confidence thấp" | Thay bằng ngưỡng không-vào-lệnh (6.2) |
| Polymarket trong 8.1/8.6 | Không có kế hoạch tích hợp cụ thể — loại tới khi có registry entry |
| "Minuette nếu rõ" (15m) | Chủ quan — thay bằng ngưỡng ZigZag định lượng (2.2) |
| SHAP cho model deep | Thay bằng attention/integrated gradients (2.2) |
| Stacking 4 model nhưng có 6 model | Chuẩn hóa interface 6 model (2.1) |
| Retrain "định kỳ" | Lịch cụ thể + trigger drift (8.4) |
