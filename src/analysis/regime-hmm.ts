/**
 * Hidden Markov Model — 3-state Gaussian regime detector for crypto 1H bars.
 *
 * Phase 4 of lag-reduction refactor. Replaces the rule-based `effective_regime`
 * thresholds in scan-data.ts with a probabilistic regime inference.
 *
 * Features (per bar, emitted as 2-D vector):
 *   1) log_return = ln(close[t] / close[t-1])
 *   2) realized_vol = rolling std of last N log_returns (default N=12)
 *
 * Model:
 *   - 3 hidden states, relabeled post-training by emission mean of return:
 *       lowest  mean return → "bear"
 *       middle  mean return → "range"
 *       highest mean return → "bull"
 *   - Each state emits 2-D Gaussian with diagonal covariance (features assumed
 *     uncorrelated). Tractable, stable, ~200 LOC total.
 *   - Forward-backward + Baum-Welch (EM) with log-space logsumexp for numerical
 *     stability.
 *
 * Inference: forward algorithm — computes posterior P(state_T | obs_1..T) for
 * the most recent bar. Confidence = max posterior. Transitioning = confidence
 * < 0.6 OR top-2 posteriors within 0.15.
 *
 * References:
 *   - Preprints.org Mar 2026: Markov regime-switching for BTC bull/bear/sideways
 *   - QuantStart HMM tutorial (EM training, forward algorithm)
 *   - No external ML libraries — pure TypeScript, plain-array matrix ops.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RegimeState = 'bull' | 'bear' | 'range';

export interface HmmEmission {
  return_mean: number;
  return_std: number;
  vol_mean: number;
  vol_std: number;
}

export interface HmmParams {
  /** Transition matrix [3][3]: P(state_t | state_{t-1}) */
  transitions: number[][];
  /** Emission params per state: mean + stddev for (log_return, realized_vol) */
  emissions: HmmEmission[];
  /** State labels — assigned post-training by sorting emissions by return_mean */
  state_labels: RegimeState[];
  /** Initial state prior */
  initial: number[];
  /** Training metadata */
  trained_at: string;
  training_bars: number;
  training_symbol: string;
  training_interval: string;
}

export interface RegimeInference {
  state: RegimeState;
  probs: Record<RegimeState, number>;
  confidence: number;
  transitioning: boolean;
}

export interface FeatureVector {
  log_return: number;
  realized_vol: number;
}

const LOG_ZERO = -Infinity;
const MIN_STD = 1e-6;
const MIN_PROB = 1e-300;

function logSumExp(values: number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

function safeLog(x: number): number {
  return x <= 0 ? LOG_ZERO : Math.log(x);
}

/** Log-density of 1-D Gaussian: ln N(x | mean, std) */
function logGaussian1D(x: number, mean: number, std: number): number {
  const s = Math.max(std, MIN_STD);
  const z = (x - mean) / s;
  return -0.5 * Math.log(2 * Math.PI) - Math.log(s) - 0.5 * z * z;
}

/** Log-density of 2-D Gaussian with diagonal covariance (features independent) */
function logEmission(feat: FeatureVector, em: HmmEmission): number {
  return (
    logGaussian1D(feat.log_return, em.return_mean, em.return_std) +
    logGaussian1D(feat.realized_vol, em.vol_mean, em.vol_std)
  );
}

export class RegimeHmm {
  /**
   * Compute features for a close-price series.
   * Returns one feature vector per bar starting at index volWindow (to allow
   * realized_vol rolling window to fill). Length = closes.length - 1 - volWindow + 1.
   */
  static features(closes: number[], volWindow = 12): FeatureVector[] {
    if (closes.length < volWindow + 2) return [];
    const logReturns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = Math.log(closes[i] / closes[i - 1]);
      logReturns.push(Number.isFinite(r) ? r : 0);
    }
    const features: FeatureVector[] = [];
    for (let i = volWindow - 1; i < logReturns.length; i++) {
      // rolling std over [i - volWindow + 1 .. i]
      let mean = 0;
      for (let k = i - volWindow + 1; k <= i; k++) mean += logReturns[k];
      mean /= volWindow;
      let varSum = 0;
      for (let k = i - volWindow + 1; k <= i; k++) {
        const d = logReturns[k] - mean;
        varSum += d * d;
      }
      const std = Math.sqrt(varSum / volWindow);
      features.push({ log_return: logReturns[i], realized_vol: std });
    }
    return features;
  }

  static load(filePath: string): HmmParams {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as HmmParams;
    if (
      !Array.isArray(parsed.transitions) ||
      !Array.isArray(parsed.emissions) ||
      !Array.isArray(parsed.state_labels) ||
      !Array.isArray(parsed.initial)
    ) {
      throw new Error('Invalid HMM params shape');
    }
    return parsed;
  }

  static save(filePath: string, params: HmmParams): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(params, null, 2));
  }

  /**
   * Forward algorithm in log-space. Returns posterior probabilities for the
   * most recent observation, plus chosen state + transitioning flag.
   */
  static infer(closes: number[], params: HmmParams): RegimeInference {
    const feats = RegimeHmm.features(closes);
    if (feats.length === 0) {
      throw new Error('Not enough closes to compute features');
    }
    const N = params.transitions.length;
    if (N !== 3) throw new Error('Expected 3-state HMM');

    // Log-alpha forward pass
    const logPi = params.initial.map((p) => safeLog(p));
    const logA = params.transitions.map((row) => row.map((p) => safeLog(p)));

    // Initialize
    let logAlpha = new Array<number>(N);
    const f0 = feats[0];
    for (let i = 0; i < N; i++) {
      logAlpha[i] = logPi[i] + logEmission(f0, params.emissions[i]);
    }

    for (let t = 1; t < feats.length; t++) {
      const ft = feats[t];
      const next = new Array<number>(N);
      for (let j = 0; j < N; j++) {
        const terms = new Array<number>(N);
        for (let i = 0; i < N; i++) terms[i] = logAlpha[i] + logA[i][j];
        next[j] = logSumExp(terms) + logEmission(ft, params.emissions[j]);
      }
      logAlpha = next;
    }

    // Posterior at last bar = softmax(logAlpha)
    const norm = logSumExp(logAlpha);
    const probsByIdx = logAlpha.map((la) => Math.exp(la - norm));

    // Map index → label
    const probs: Record<RegimeState, number> = { bull: 0, bear: 0, range: 0 };
    for (let i = 0; i < N; i++) {
      probs[params.state_labels[i]] += probsByIdx[i];
    }

    // Top state + confidence
    const labels: RegimeState[] = ['bull', 'bear', 'range'];
    let topState: RegimeState = 'range';
    let topProb = -1;
    for (const lab of labels) {
      if (probs[lab] > topProb) {
        topProb = probs[lab];
        topState = lab;
      }
    }
    // Second-highest for transitioning check
    const sorted = labels.map((l) => probs[l]).sort((a, b) => b - a);
    const transitioning = topProb < 0.6 || sorted[0] - sorted[1] < 0.15;

    return {
      state: topState,
      probs,
      confidence: topProb,
      transitioning,
    };
  }

  /**
   * K-means (k=3) on 2-D feature vectors. Returns cluster means + variance.
   * Used to initialize EM emission parameters.
   */
  static kmeansInit(feats: FeatureVector[], k = 3, iterations = 20): HmmEmission[] {
    if (feats.length < k) throw new Error('Not enough features for k-means init');
    // Seed: pick k samples spread by log_return quantile
    const sorted = [...feats].sort((a, b) => a.log_return - b.log_return);
    const seeds: FeatureVector[] = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor((i + 0.5) * (sorted.length / k));
      seeds.push(sorted[idx]);
    }
    let centroids = seeds.map((s) => ({ r: s.log_return, v: s.realized_vol }));

    for (let it = 0; it < iterations; it++) {
      const sums = centroids.map(() => ({ r: 0, v: 0, n: 0 }));
      for (const f of feats) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = f.log_return - centroids[c].r;
          const dv = f.realized_vol - centroids[c].v;
          const d = dr * dr + dv * dv;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        sums[best].r += f.log_return;
        sums[best].v += f.realized_vol;
        sums[best].n++;
      }
      for (let c = 0; c < k; c++) {
        if (sums[c].n > 0) {
          centroids[c] = { r: sums[c].r / sums[c].n, v: sums[c].v / sums[c].n };
        }
      }
    }

    // Variance per cluster
    const emissions: HmmEmission[] = centroids.map((c) => ({
      return_mean: c.r,
      return_std: 0,
      vol_mean: c.v,
      vol_std: 0,
    }));
    const counts = new Array(k).fill(0);
    const varSums = centroids.map(() => ({ r: 0, v: 0 }));
    for (const f of feats) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = f.log_return - centroids[c].r;
        const dv = f.realized_vol - centroids[c].v;
        const d = dr * dr + dv * dv;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      counts[best]++;
      const dr = f.log_return - centroids[best].r;
      const dv = f.realized_vol - centroids[best].v;
      varSums[best].r += dr * dr;
      varSums[best].v += dv * dv;
    }
    for (let c = 0; c < k; c++) {
      const n = Math.max(counts[c], 1);
      emissions[c].return_std = Math.max(Math.sqrt(varSums[c].r / n), MIN_STD);
      emissions[c].vol_std = Math.max(Math.sqrt(varSums[c].v / n), MIN_STD);
    }
    return emissions;
  }

  /**
   * Baum-Welch training on a feature sequence. Returns fitted HMM params.
   *
   * @param feats sequence of 2-D feature vectors
   * @param maxIter max EM iterations (default 100)
   * @param tol log-likelihood convergence tolerance (default 1e-4)
   */
  static train(
    feats: FeatureVector[],
    opts: {
      symbol: string;
      interval: string;
      maxIter?: number;
      tol?: number;
    },
  ): { params: HmmParams; iterations: number; finalLogLik: number } {
    const maxIter = opts.maxIter ?? 100;
    const tol = opts.tol ?? 1e-4;
    const N = 3;
    const T = feats.length;
    if (T < 50) throw new Error('Too few bars to fit HMM (need ≥50)');

    // Init: transitions soft-diagonal, emissions from k-means, prior uniform
    let A = [
      [0.85, 0.075, 0.075],
      [0.075, 0.85, 0.075],
      [0.075, 0.075, 0.85],
    ];
    let emissions = RegimeHmm.kmeansInit(feats, N);
    let pi = [1 / 3, 1 / 3, 1 / 3];

    let prevLogLik = -Infinity;
    let iter = 0;

    for (; iter < maxIter; iter++) {
      // === E-step: forward-backward in log space ===
      const logPi = pi.map(safeLog);
      const logA = A.map((row) => row.map(safeLog));
      const logB: number[][] = feats.map((f) =>
        emissions.map((em) => logEmission(f, em)),
      );

      // Forward
      const logAlpha: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
      for (let i = 0; i < N; i++) logAlpha[0][i] = logPi[i] + logB[0][i];
      for (let t = 1; t < T; t++) {
        for (let j = 0; j < N; j++) {
          const terms = new Array(N);
          for (let i = 0; i < N; i++) terms[i] = logAlpha[t - 1][i] + logA[i][j];
          logAlpha[t][j] = logSumExp(terms) + logB[t][j];
        }
      }
      const logLik = logSumExp(logAlpha[T - 1]);

      // Backward
      const logBeta: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
      for (let i = 0; i < N; i++) logBeta[T - 1][i] = 0;
      for (let t = T - 2; t >= 0; t--) {
        for (let i = 0; i < N; i++) {
          const terms = new Array(N);
          for (let j = 0; j < N; j++) {
            terms[j] = logA[i][j] + logB[t + 1][j] + logBeta[t + 1][j];
          }
          logBeta[t][i] = logSumExp(terms);
        }
      }

      // Gamma: P(state_t = i | obs)
      const logGamma: number[][] = Array.from({ length: T }, () => new Array(N).fill(0));
      for (let t = 0; t < T; t++) {
        const sum = logSumExp(
          logAlpha[t].map((la, i) => la + logBeta[t][i]),
        );
        for (let i = 0; i < N; i++) {
          logGamma[t][i] = logAlpha[t][i] + logBeta[t][i] - sum;
        }
      }

      // Xi: P(state_t = i, state_{t+1} = j | obs)
      const logXiSum: number[][] = Array.from({ length: N }, () => new Array(N).fill(-Infinity));
      for (let t = 0; t < T - 1; t++) {
        const denomTerms: number[] = [];
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            denomTerms.push(
              logAlpha[t][i] + logA[i][j] + logB[t + 1][j] + logBeta[t + 1][j],
            );
          }
        }
        const denom = logSumExp(denomTerms);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const logXi =
              logAlpha[t][i] + logA[i][j] + logB[t + 1][j] + logBeta[t + 1][j] - denom;
            logXiSum[i][j] = logSumExp([logXiSum[i][j], logXi]);
          }
        }
      }

      // === M-step ===
      // Initial
      pi = logGamma[0].map((lg) => Math.max(Math.exp(lg), MIN_PROB));
      const piSum = pi.reduce((s, v) => s + v, 0);
      pi = pi.map((p) => p / piSum);

      // Transitions
      const gammaRowSum: number[] = new Array(N).fill(-Infinity);
      for (let i = 0; i < N; i++) {
        const terms: number[] = [];
        for (let t = 0; t < T - 1; t++) terms.push(logGamma[t][i]);
        gammaRowSum[i] = logSumExp(terms);
      }
      A = Array.from({ length: N }, () => new Array(N).fill(0));
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          A[i][j] = Math.exp(logXiSum[i][j] - gammaRowSum[i]);
        }
        // Normalize defensively
        const rs = A[i].reduce((s, v) => s + v, 0);
        if (rs > 0) for (let j = 0; j < N; j++) A[i][j] /= rs;
      }

      // Emissions — weighted mean + std per state
      const newEm: HmmEmission[] = [];
      for (let i = 0; i < N; i++) {
        // gamma weights for all t (include last)
        const weights = logGamma.map((row) => Math.exp(row[i]));
        let wSum = 0;
        let wrMean = 0;
        let wvMean = 0;
        for (let t = 0; t < T; t++) {
          wSum += weights[t];
          wrMean += weights[t] * feats[t].log_return;
          wvMean += weights[t] * feats[t].realized_vol;
        }
        const rMean = wSum > 0 ? wrMean / wSum : 0;
        const vMean = wSum > 0 ? wvMean / wSum : 0;
        let wrVar = 0;
        let wvVar = 0;
        for (let t = 0; t < T; t++) {
          const dr = feats[t].log_return - rMean;
          const dv = feats[t].realized_vol - vMean;
          wrVar += weights[t] * dr * dr;
          wvVar += weights[t] * dv * dv;
        }
        newEm.push({
          return_mean: rMean,
          return_std: Math.max(Math.sqrt(wrVar / Math.max(wSum, 1e-10)), MIN_STD),
          vol_mean: vMean,
          vol_std: Math.max(Math.sqrt(wvVar / Math.max(wSum, 1e-10)), MIN_STD),
        });
      }
      emissions = newEm;

      // Convergence
      if (Math.abs(logLik - prevLogLik) < tol && iter > 5) {
        iter++;
        prevLogLik = logLik;
        break;
      }
      prevLogLik = logLik;
    }

    // Relabel by return_mean: lowest=bear, middle=range, highest=bull
    const order = [0, 1, 2].sort(
      (a, b) => emissions[a].return_mean - emissions[b].return_mean,
    );
    const labelByIdx: RegimeState[] = new Array(3);
    labelByIdx[order[0]] = 'bear';
    labelByIdx[order[1]] = 'range';
    labelByIdx[order[2]] = 'bull';

    const params: HmmParams = {
      transitions: A,
      emissions,
      state_labels: labelByIdx,
      initial: pi,
      trained_at: new Date().toISOString(),
      training_bars: T,
      training_symbol: opts.symbol,
      training_interval: opts.interval,
    };

    return { params, iterations: iter, finalLogLik: prevLogLik };
  }
}
