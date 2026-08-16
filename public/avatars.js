// Cartoon Nova crew. The avatars are drawn as inline SVG instead of shipping
// image files: they stay crisp at any size, theme with the app, and cost the
// packaged build nothing.
(function () {
  const CHARACTERS = [
    { id: "nova",      label: "Nova",       bg: ["#8b6bff", "#3d2f96"], skin: ["#ffe0c4", "#ffbe94"], hair: "#3a2a6b", style: "helmet",     eyes: "star",   mouth: "smile" },
    { id: "astro",     label: "Astro",      bg: ["#5aa9ff", "#1f4fb5"], skin: ["#f7d3b0", "#e0aa80"], hair: "#2b2440", style: "helmet",     eyes: "happy",  mouth: "grin" },
    { id: "comet",     label: "Comet",      bg: ["#ffb26b", "#e0553f"], skin: ["#ffdcc2", "#f3b184"], hair: "#8a3b1f", style: "scarf",      eyes: "wink",   mouth: "grin" },
    { id: "luna",      label: "Luna",       bg: ["#cfd8ff", "#7b86d6"], skin: ["#ffe6d2", "#f0bd9c"], hair: "#5b4bb5", style: "buns",       eyes: "happy",  mouth: "smile" },
    { id: "solar",     label: "Solar",      bg: ["#ffd76e", "#f5872a"], skin: ["#ffdcb8", "#eeae76"], hair: "#c25a12", style: "shades",     eyes: "happy",  mouth: "grin" },
    { id: "pixel",     label: "Pixel",      bg: ["#9df5d0", "#22a37a"], skin: ["#d7f7ea", "#8fd8bf"], hair: "#177a5c", style: "antenna",    eyes: "dots",   mouth: "smile" },
    { id: "orbit",     label: "Orbit",      bg: ["#7f9cff", "#3d55c9"], skin: ["#e6ecff", "#b3c1f5"], hair: "#2b3a7a", style: "headphones", eyes: "happy",  mouth: "smile" },
    { id: "zap",       label: "Zap",        bg: ["#ff8fa3", "#d63a5c"], skin: ["#ffdccd", "#f0ab98"], hair: "#7a1f38", style: "bolt",       eyes: "wink",   mouth: "grin" },
    { id: "quasar",    label: "Quasar",     bg: ["#b18bff", "#5a2fb0"], skin: ["#efd9ff", "#c9a4f0"], hair: "#3d1c73", style: "horns",      eyes: "star",   mouth: "smile" },
    { id: "pulsar",    label: "Pulsar",     bg: ["#8fe6ff", "#2b8fc4"], skin: ["#dff6ff", "#a6dcf0"], hair: "#1d6285", style: "antenna",    eyes: "sleepy", mouth: "smile" },
    { id: "ember",     label: "Ember",      bg: ["#ffa26b", "#c93a2a"], skin: ["#ffd9bf", "#eda87f"], hair: "#7c2a15", style: "cap",        eyes: "happy",  mouth: "grin" },
    { id: "aurora",    label: "Aurora",     bg: ["#7ef7d8", "#2f8fd6"], skin: ["#ffe7d6", "#f2bb9c"], hair: "#1f7f8c", style: "crown",      eyes: "star",   mouth: "smile" },
    { id: "vega",      label: "Vega",       bg: ["#ffe27a", "#e0a90f"], skin: ["#ffe3c6", "#f0bb8c"], hair: "#a06f0d", style: "buns",       eyes: "wink",   mouth: "smile" },
    { id: "rover",     label: "Rover",      bg: ["#b8c6da", "#61728c"], skin: ["#e9eef6", "#b6c2d4"], hair: "#3f4b60", style: "visorbot",   eyes: "dots",   mouth: "bot" },
    { id: "zeta",      label: "Zeta",       bg: ["#9df5a8", "#2fbf6f"], skin: ["#c9f7c4", "#82d68f"], hair: "#177a3c", style: "alien",      eyes: "big",    mouth: "smile" },
    { id: "cosmo",     label: "Cosmo",      bg: ["#f7a8ff", "#8c3fd6"], skin: ["#ffe0f4", "#f0b0dc"], hair: "#6d1f8c", style: "halo",       eyes: "happy",  mouth: "grin" }
  ];

  function eyes(kind) {
    if (kind === "star") {
      return `<path d="M37 51l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="#2b2440"/>
              <path d="M63 51l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="#2b2440"/>`;
    }
    if (kind === "wink") {
      return `<circle cx="38" cy="57" r="5.4" fill="#2b2440"/><circle cx="40" cy="55" r="1.9" fill="#fff"/>
              <path d="M57 57q5-6 10 0" stroke="#2b2440" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
    }
    if (kind === "dots") {
      return `<circle cx="38" cy="57" r="3.4" fill="#2b2440"/><circle cx="62" cy="57" r="3.4" fill="#2b2440"/>`;
    }
    if (kind === "sleepy") {
      return `<path d="M33 58q5-5 10 0" stroke="#2b2440" stroke-width="3.4" fill="none" stroke-linecap="round"/>
              <path d="M57 58q5-5 10 0" stroke="#2b2440" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
    }
    if (kind === "big") {
      return `<ellipse cx="37" cy="57" rx="7" ry="9" fill="#2b2440"/><ellipse cx="63" cy="57" rx="7" ry="9" fill="#2b2440"/>
              <circle cx="39" cy="53" r="2.4" fill="#fff"/><circle cx="65" cy="53" r="2.4" fill="#fff"/>`;
    }
    return `<circle cx="38" cy="57" r="5.4" fill="#2b2440"/><circle cx="40" cy="55" r="1.9" fill="#fff"/>
            <circle cx="62" cy="57" r="5.4" fill="#2b2440"/><circle cx="64" cy="55" r="1.9" fill="#fff"/>`;
  }

  function mouth(kind) {
    if (kind === "grin") {
      return `<path d="M40 70q10 10 20 0z" fill="#8c2f4a"/><path d="M40 70h20" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
    }
    if (kind === "bot") {
      return `<rect x="41" y="69" width="18" height="6" rx="3" fill="#2b2440"/>`;
    }
    return `<path d="M42 70q8 7 16 0" stroke="#2b2440" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  }

  function behind(style, character) {
    if (style === "buns") {
      return `<circle cx="20" cy="38" r="11" fill="${character.hair}"/><circle cx="80" cy="38" r="11" fill="${character.hair}"/>`;
    }
    if (style === "alien") {
      return `<path d="M27 30q-4-14 5-16 6 5 4 17z" fill="${character.hair}"/>
              <path d="M73 30q4-14-5-16-6 5-4 17z" fill="${character.hair}"/>`;
    }
    if (style === "antenna") {
      return `<path d="M50 22v-10" stroke="${character.hair}" stroke-width="3.5" stroke-linecap="round"/>
              <circle cx="50" cy="10" r="5" fill="#ffe27a"/>`;
    }
    if (style === "horns") {
      return `<path d="M28 28q-8-12 0-16 6 6 6 14z" fill="${character.hair}"/>
              <path d="M72 28q8-12 0-16-6 6-6 14z" fill="${character.hair}"/>`;
    }
    return "";
  }

  function front(style, character, id) {
    if (style === "helmet") {
      return `<circle cx="50" cy="55" r="39" fill="url(#${id}-glass)" stroke="#e8eeff" stroke-width="4" opacity=".92"/>
              <path d="M26 38q10-14 26-14" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".75"/>
              <rect x="34" y="90" width="32" height="9" rx="4.5" fill="#dfe6f7"/>`;
    }
    if (style === "shades") {
      return `<rect x="26" y="49" width="20" height="13" rx="6" fill="#2b2440"/>
              <rect x="54" y="49" width="20" height="13" rx="6" fill="#2b2440"/>
              <path d="M46 55h8" stroke="#2b2440" stroke-width="4"/>`;
    }
    if (style === "headphones") {
      return `<path d="M20 55a30 30 0 0 1 60 0" stroke="${character.hair}" stroke-width="6" fill="none" stroke-linecap="round"/>
              <rect x="12" y="50" width="14" height="22" rx="7" fill="${character.hair}"/>
              <rect x="74" y="50" width="14" height="22" rx="7" fill="${character.hair}"/>`;
    }
    if (style === "cap") {
      return `<path d="M20 40q30-28 60 0z" fill="${character.hair}"/><path d="M18 40h44v7H18z" fill="${character.hair}" opacity=".8"/>`;
    }
    if (style === "crown") {
      return `<path d="M30 32l7 10h26l7-10-10 5-10-11-10 11z" fill="#ffd76e" stroke="#e0a90f" stroke-width="2" stroke-linejoin="round"/>`;
    }
    if (style === "halo") {
      return `<ellipse cx="50" cy="18" rx="20" ry="6" fill="none" stroke="#ffe27a" stroke-width="4"/>`;
    }
    if (style === "scarf") {
      return `<path d="M28 84q22 12 44 0v10H28z" fill="${character.hair}"/>`;
    }
    if (style === "visorbot") {
      return `<rect x="24" y="46" width="52" height="18" rx="9" fill="#2b2440" opacity=".9"/>
              <circle cx="38" cy="55" r="4" fill="#7ef7d8"/><circle cx="62" cy="55" r="4" fill="#7ef7d8"/>`;
    }
    if (style === "bolt") {
      return `<path d="M56 16l-14 20h10l-6 16 18-22H54z" fill="#ffe27a" stroke="#e0a90f" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
    return "";
  }

  function hair(style, character) {
    if (style === "helmet" || style === "visorbot" || style === "cap") return "";
    return `<path d="M22 50q2-30 28-30t28 30q-6-14-28-14T22 50z" fill="${character.hair}"/>`;
  }

  /** One cartoon portrait, sized by the element it is dropped into. */
  function avatarSvg(avatarId) {
    const character = CHARACTERS.find(item => item.id === avatarId);
    if (!character) return "";
    const id = `nv-${character.id}`;
    const showFace = character.style !== "visorbot";
    return `<svg class="nova-avatar" viewBox="0 0 100 100" role="img" aria-label="${character.label} avatar" focusable="false">
      <defs>
        <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${character.bg[0]}"/><stop offset="1" stop-color="${character.bg[1]}"/>
        </linearGradient>
        <linearGradient id="${id}-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${character.skin[0]}"/><stop offset="1" stop-color="${character.skin[1]}"/>
        </linearGradient>
        <radialGradient id="${id}-glass" cx=".35" cy=".3" r=".8">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".45"/><stop offset="1" stop-color="#8fd7ff" stop-opacity=".18"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill="url(#${id}-bg)"/>
      <circle cx="26" cy="24" r="3" fill="#fff" opacity=".7"/>
      <circle cx="78" cy="30" r="2" fill="#fff" opacity=".55"/>
      <circle cx="70" cy="16" r="1.6" fill="#fff" opacity=".45"/>
      ${behind(character.style, character)}
      <ellipse cx="50" cy="58" rx="30" ry="30" fill="url(#${id}-skin)"/>
      ${hair(character.style, character)}
      ${showFace ? `${eyes(character.eyes)}
      <circle cx="30" cy="67" r="5" fill="#ff9bb0" opacity=".55"/>
      <circle cx="70" cy="67" r="5" fill="#ff9bb0" opacity=".55"/>
      ${mouth(character.mouth)}` : ""}
      ${front(character.style, character, id)}
    </svg>`;
  }

  window.NovaAvatars = { list: CHARACTERS, svg: avatarSvg };
})();
