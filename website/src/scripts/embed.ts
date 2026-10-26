// Swap a post card for LinkedIn's own embed, only when asked, so the page makes no third-party requests
// until then. Content blockers often stop LinkedIn frames, and Chrome then collapses the frame to nothing,
// so the card stays until the frame has really rendered, and comes back with a note if it never does.

const GIVE_UP_MS = 6000;

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-embed]")) {
  button.addEventListener("click", () => {
    const post = button.closest<HTMLElement>("[data-post]");
    const card = post?.querySelector<HTMLElement>("[data-post-card]");
    const note = post?.querySelector<HTMLElement>("[data-post-note]");
    const src = button.dataset.embed;
    if (!post || !card || !note || !src) return;

    button.disabled = true;
    button.textContent = "Loading the post…";

    const frame = document.createElement("iframe");
    frame.className = "post-frame";
    frame.src = src;
    frame.title = "LinkedIn post";
    frame.allowFullscreen = true;
    frame.hidden = true;
    post.append(frame);

    let settled = false;
    const settle = (shown: boolean) => {
      if (settled) return;
      settled = true;
      if (shown) {
        card.hidden = true;
        frame.focus();
      } else {
        frame.remove();
        button.remove();
        note.textContent = "Your browser blocked LinkedIn's embed. The post is one click away on LinkedIn.";
      }
    };

    frame.addEventListener("load", () => {
      // A blocked frame can still fire load; only a frame with a layout box was actually let through.
      frame.hidden = false;
      requestAnimationFrame(() => settle(frame.offsetHeight > 0));
    });
    setTimeout(() => settle(false), GIVE_UP_MS);
  });
}

export {};
