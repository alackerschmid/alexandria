import type { Ref } from "vue";
import Quagga from "@ericblade/quagga2";

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

  let started = false;
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
    if (!container.value || started) return;

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
    if (started) {
      Quagga.stop();
      started = false;
    }
  }

  const isRunning = () => started;

  return { start, stop, isRunning };
}
