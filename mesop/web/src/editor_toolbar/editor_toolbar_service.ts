import {Injectable, NgZone} from '@angular/core';
import {SSE} from '../utils/sse';
import {BehaviorSubject, Observable} from 'rxjs';
import {SourceCodeLocation} from 'mesop/mesop/protos/ui_jspb_proto_pb/mesop/protos/ui_pb';

export interface PromptInteraction extends PromptResponse {
  readonly prompt: string;
  readonly path: string;
}

export interface PromptResponse {
  readonly beforeCode: string;
  readonly afterCode: string;
  readonly diff: string;
  readonly lineNumber: number | undefined;
}

interface GenerateEndMessage extends PromptResponse {
  readonly type: 'end';
}

interface GenerateProgressMessage {
  readonly type: 'progress';
  readonly data: string;
}

type GenerateData = GenerateEndMessage | GenerateProgressMessage;

@Injectable({
  providedIn: 'root',
})
export class EditorToolbarService {
  history: PromptInteraction[] = [];
  eventSource: SSE | undefined;
  private readonly generationProgressSubject = new BehaviorSubject<string>('');
  readonly generationProgress$: Observable<string> =
    this.generationProgressSubject.asObservable();

  constructor(private readonly ngZone: NgZone) {}

  getHistory(): readonly PromptInteraction[] {
    return this.history;
  }

  async sendPrompt(
    prompt: string,
    sourceCodeLocation?: SourceCodeLocation | undefined,
  ): Promise<PromptResponse> {
    console.debug('sendPrompt', prompt);
    // Clear the progress subject
    this.generationProgressSubject.next('');
    const path = window.location.pathname;
    const lineNumber = sourceCodeLocation?.getLine();
    return new Promise((resolve, reject) => {
      this.eventSource = new SSE('/__editor__/generate', {
        payload: JSON.stringify({
          prompt,
          path,
          lineNumber,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      this.eventSource.addEventListener('message', (e) => {
        // Looks like Angular has a bug where it's not intercepting EventSource onmessage.
        this.ngZone.run(() => {
          try {
            const data = (e as any).data;
            const obj = JSON.parse(data) as GenerateData;
            if (!obj.type) {
              reject(new Error('Invalid event source message'));
              return;
            }
            if (obj.type === 'end') {
              this.eventSource!.close();
              this.eventSource = undefined;
              const {beforeCode, afterCode, diff} = obj;
              this.history.unshift({
                path,
                prompt,
                beforeCode,
                afterCode,
                diff,
                lineNumber,
              });
              resolve({beforeCode, afterCode, diff, lineNumber});
            }
            if (obj.type === 'progress') {
              this.generationProgressSubject.next(
                this.generationProgressSubject.getValue() + obj.data,
              );
            }
          } catch (e) {
            console.error('sendPrompt eventSource error', e);
            reject(e);
          }
        });
      });
    });
  }

  async commit(code: string) {
    console.debug('commit', prompt);
    const response = await fetch('/__editor__/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({code, path: window.location.pathname}),
    });
    await handleError(response);
  }

  async saveInteraction(interaction: PromptInteraction): Promise<string> {
    console.debug('saveInteraction', interaction);
    const response = await fetch('/__editor__/save-interaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: interaction.prompt,
        beforeCode: interaction.beforeCode,
        diff: interaction.diff,
        lineNumber: interaction.lineNumber,
      }),
    });
    await handleError(response);
    const json = (await response.json()) as {folder: string};
    return json.folder;
  }
}

async function handleError(response: Response) {
  if (response.ok) {
    return;
  }
  console.error(response.status, response.statusText);
  let error = '';
  try {
    error = await response.text();
  } catch (e) {}
  throw new Error(`${response.status} ${response.statusText} ${error}`);
}