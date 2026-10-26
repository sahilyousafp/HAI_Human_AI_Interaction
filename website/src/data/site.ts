export const site = {
  name: "HAI",
  url: "https://hai.spairl.si",
  title: "HAI - Human AI Interface, built in public",
  description:
    "HAI is an open-source interaction layer that lets AEC professionals work with an AI agent and their design software using hands, face and voice from a normal laptop webcam. Follow the build, stage by stage.",
  spairl: "https://www.spairl.si",
  linkedin: "https://www.linkedin.com/in/sahil-yousaf-882a0b132/",
  email: "management@spairl.si",
};

export type NavItem = { id: string; label: string; href?: string; soon?: boolean };

export const nav: NavItem[] = [
  { id: "stages", label: "Stages", href: "/#stages" },
  { id: "about", label: "About", href: "/#about" },
  { id: "github", label: "GitHub", soon: true },
];
