import type { Ref } from "vue";
import Quagga from "@ericblade/quagga2";

// Quagga is a module singleton wrapping one camera, so the lifecycle state that tracks who owns
// it has to be module-level too — per-composable copies let a torn-down instance's late init
// callback act on a stream a *newer* instance now owns (leave /scanner mid-init, come back, and
// the dead callback stops the live camera, which nothing then restarts).
//
// `generation` is bumped by every start() and every stop(); an init callback whose token is no
// longer current knows it lost the camera. `owner` is the token of whoever currently holds it
// (or has an init in flight), `started` whether the stream is actually running.
let generation = 0;
let owner: number | null = null;
let started = false;

/**
 * Wraps the Quagga2 live-camera barcode scanner: init/start/stop lifecycle plus a
 * small consecutive-read buffer that filters decoder noise. Isolates the only
 * third-party integration in the scanner page so it can be reasoned about (and
 * swapped) independently of the scan state machine.
 *
 * - `container` — the element Quagga renders the camera stream into
 * - `onDetect`  — fires with an ISBN once `requiredHits` consecutive reads agree
 * - `onError`   — fires if the camera fails to initialise
 */
export function useBarcodeScanner(options: {
  container: Ref<HTMLElement | null>;
  onDetect: (code: string) => void;
  onError: (err: unknown) => void;
  requiredHits?: number;
}) {
  const { container, onDetect, onError, requiredHits = 2 } = options;

  // Require N consecutive reads of the same code before firing — filters noise
  // without adding perceptible delay at typical camera frame rates.
  const detectionBuffer: string[] = [];

  const onQuaggaDetected = (result: {
    codeResult: { code: string | null };
  }) => {
    const code = result.codeResult.code;
    if (!code) return;

    detectionBuffer.push(code);
    if (detectionBuffer.length > requiredHits) detectionBuffer.shift();

    if (
      detectionBuffer.length === requiredHits &&
      detectionBuffer.every((c) => c === code)
    ) {
      detectionBuffer.length = 0;
      onDetect(code);
    }
  };

  function start() {
    if (!container.value || started || owner !== null) return;
    const token = ++generation;
    owner = token;

    Quagga.init(
      {
        inputStream: {
          type: "LiveStream",
          target: container.value,
          constraints: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        locator: { patchSize: "medium", halfSample: true },
        // numOfWorkers: 0 avoids Vite/worker-blob compatibility issues
        numOfWorkers: 0,
        decoder: { readers: ["ean_reader", "ean_8_reader"] },
        locate: true,
      },
      (err: unknown) => {
        if (owner !== token) {
          // We lost the camera while negotiating it. Release the stream this init acquired, but
          // only if nobody has taken it since — a newer start() owns Quagga now, and stopping
          // would kill *its* camera with no path back (its `started` stays true, so start()
          // early-returns and the UI exposes no way to recover).
          if (!err && owner === null && !started) Quagga.stop();
          return;
        }
        owner = null;
        if (err) {
          console.error(err);
          onError(err);
          return;
        }
        Quagga.start();
        started = true;
      },
    );

    Quagga.onDetected(onQuaggaDetected);
  }

  function stop() {
    Quagga.offDetected(onQuaggaDetected);
    // Bumping the generation is what tells an in-flight init it no longer owns the camera; it
    // releases the stream itself (see start), since it can't be stopped before it exists.
    generation++;
    owner = null;
    if (started) {
      Quagga.stop();
      started = false;
    }
  }

  const isRunning = () => started;

  return { start, stop, isRunning };
}
