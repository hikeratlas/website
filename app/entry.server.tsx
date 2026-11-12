// The server's response for a page: the app rendered as a stream, or all of
// it at once for bots (so crawlers get the whole page).
import { ServerRouter, type EntryContext, type RouterContextProvider } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: RouterContextProvider
) {
  let shellRendered = false;
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors in the shell reject the stream; log the ones after it.
        if (shellRendered) console.error(error);
      },
    }
  );
  shellRendered = true;

  if (isbot(request.headers.get("user-agent") || "") || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
