const defaultSource = `diagram "Browser acceptance" {
  lane flow "Verification flow" {
    layout row gap 80
    source: card "XDraw source" info
    preview: card "Progressive preview" warning
    final: card "Editable canvas" success
    source -> preview -> final
  }
}`;

const parameters = new URLSearchParams(location.search);
const source = parameters.get("source") ?? defaultSource;

const status = document.querySelector<HTMLDivElement>("#status")!;
const iframe = document.querySelector<HTMLIFrameElement>("#app")!;

function phase(value: string, message: string) {
  status.dataset.phase = value;
  status.textContent = message;
}

async function waitForAppText(text: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (iframe.contentDocument?.body.textContent?.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`App did not render expected text: ${text}`);
}

async function main() {
  phase("loading", "Rendering diagram.");
  iframe.src = `/viewer.html?source=${encodeURIComponent(source)}`;
  await new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
  await waitForAppText("Editable diagram");
  phase("ready", "Editable diagram ready.");
}

main().catch((error) => {
  phase("error", error instanceof Error ? error.message : String(error));
  throw error;
});
