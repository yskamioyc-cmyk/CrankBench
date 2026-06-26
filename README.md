# CrankBench 
> **2D Kinematic Engine Bench Simulator**

Rust（Tauri）の高速な計算性能と、React/TypeScriptによるモダンなUIを組み合わせた、リアルタイム熱力学・運動学エンジンシミュレータです。クランク機構の2Dアニメーションと、P-V線図・T-S線図の動的なプロットを、軽量かつ滑らかに実行します。

---

##  主な機能

- **動的メカニズムシミュレーション**: ボア径、ストローク、コンロッド長、圧縮比をリアルタイムに変更し、エンジンの挙動を即座に再計算。
- **マルチレイアウト対応**: 単気筒だけでなく、直列3気筒（120°）、直列4気筒（180°）、直列6気筒（120°）のクランク位相変化を正確に再現。
- **熱力学サイクルプロット**: 
  - **P-V線図 (Pressure - Volume)**: 1気筒あたりの図示仕事を可視化。
  - **T-S線図 (Temperature - Entropy)**: 断熱過程や等容燃焼における熱力学的エネルギー推移を可視化。
- **性能予測（ベンチマーク）**: 生成されたデータから、最大9000 RPMまでのトルク曲線・出力曲線を内部でエミュレートし、最大トルク（Nm）および最高出力（PS）をリアルタイム算出。

---

##  技術スタック

- **Frontend**: React, TypeScript, Vite, Recharts
- **Backend (Desktop Shell)**: Rust, Tauri v2
- **Graphics**: HTML5 Canvas (2D Context)

---

##  描画最適化のアーキテクチャ

本プロジェクトでは、高頻度なデータ更新と滑らかな2Dアニメーションを両立するため、**「Reactのレンダリングサイクルからの脱却」**をテーマにしたハイブリッド設計を採用しています。

```
[Rust Backend] (高速計算)
       │  (Tauri IPC)
       ▼
[React App Component] ──(静的背景データ)──> [Recharts (グラフ)] 
       │                                         ▲
       │ (useRefによる制御)                      │ (15FPS 間引き更新)
       ▼                                         │
[Engine2D Component] ───(requestAnimationFrame)─┘
       │
       ├─(60FPS)─> [HTML5 Canvas] (ピストン・クランクの描画)
       └─(60FPS)─> [DOM Direct Update] (圧力・温度等のテキスト数値を直接書き換え)
```

1. **DOM Direct Update (60FPS)**:
   毎フレーム変化するクランク角や筒内圧力・温度などの数値テキストは、Reactの `State` を介さず、`useRef` を用いてブラウザのDOMへ直接インジェクションしています。これにより、Reactの不要な再レンダリング（仮想DOMの再計算）を100%抑制しています。
2. **描画負荷の分散**:
   メインのアニメーションおよびCanvas描画はブラウザの最高リフレッシュレート（60FPS+）で駆動させつつ、描画コストの高いグラフ（Recharts）の現在点インジケーターの更新のみを **15FPS** に制限（デバウンス）することで、メインスレッドの占有を防ぎ、カクつき（Jank）を完全に解消しました。
3. **データの間引き (Data Downsampling)**:
   グラフの背景線となる720点の膨大なシミュレーションデータを、見た目の滑らかさを損なわない180点に間引いてレンダリングすることで、SVG of Rechartsの描画負荷を大幅に削減しています。

---

##  セットアップと実行方法

### 前提条件
- [Node.js](https://nodejs.org/) (v18以上推奨)
- [Rust](https://www.rust-lang.org/) (cargo, rustc)
- 各OSに応じたTauriのシステム依存関係（Tauri公式サイトを参照）

### 1. リポジトリのクローン
```bash
git clone [https://github.com/YOUR_USERNAME/CrankBench.git](https://github.com/YOUR_USERNAME/CrankBench.git)
cd CrankBench
```

### 2. 依存関係のインストール
```bash
npm install
```

### 3. 開発モードでの起動（Tauri環境）
```bash
npm run tauri dev
```

### 4. プロダクションビルド（スタンドアロンアプリの生成）
```bash
npm run tauri build
```

---

##  ライセンス

[MIT License](LICENSE)