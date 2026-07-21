import { GraphLayoutWorkerController } from '../lib/graph-layout-worker-controller'
import type { GraphLayoutCommand, GraphLayoutEvent } from '../lib/graph-layout-protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<GraphLayoutCommand>) => void) | null
  postMessage(message: GraphLayoutEvent, transfer?: Transferable[]): void
}

const workerScope = globalThis as unknown as WorkerScope
const controller = new GraphLayoutWorkerController({
  postMessage: (message, transfer) => workerScope.postMessage(message, transfer)
})

workerScope.onmessage = (event) => controller.handle(event.data)
