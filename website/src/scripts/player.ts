// Stage videos: the big play button starts the clip and then gets out of the way, and only one clip plays
// at a time, because each has narration.

const players = [...document.querySelectorAll<HTMLElement>("[data-player]")];
const videos = players.flatMap((p) => p.querySelector("video") ?? []);

for (const player of players) {
  const video = player.querySelector("video");
  const play = player.querySelector<HTMLButtonElement>("[data-play]");
  if (!video || !play) continue;

  play.addEventListener("click", () => {
    void video.play();
    video.focus();
  });
  video.addEventListener("play", () => {
    player.classList.add("started");
    for (const other of videos) if (other !== video) other.pause();
  });
}

export {};
