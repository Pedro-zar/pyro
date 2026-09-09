/**
 * Gera os ícones do sistema em icons/.
 *
 * São duas origens, e é de propósito:
 *
 *   PROPRIOS   marcas desenhadas aqui, com uma gramática só — traço de 4 numa
 *              grade de 64, pontas retas, figura inscrita num losango. Usadas
 *              onde o conceito é abstrato e nenhum desenho ilustrativo diz o
 *              que ele é (Cone, Amplo, Longo, Dividir, Gelo, Raio).
 *   DO_ACERVO  recorte do game-icons.net (CC BY 3.0), onde o conceito é uma
 *              coisa concreta e o traço ilustrativo diz melhor. O crédito da
 *              licença mora em icons/CREDITOS.md.
 *
 * O acervo entra pelo pacote @iconify-json/game-icons, que só é preciso para
 * regerar: os .svg ficam versionados, então quem só joga não instala nada.
 *
 *   npm run gerar:icones
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(RAIZ, "icons");

/** Cor única dos ícones: o texto claro da ficha (tokens.css --pyro-texto). */
const COR = "#ede6e0";

/* -------------------------------------------------------------------------- */
/*  Conjunto próprio                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Só o miolo de cada desenho. As classes viram atributos na hora de fechar o
 * arquivo: "linha" é traço sem preenchimento, "tracejado" é traço interrompido.
 */
const PROPRIOS = {
  gelo: `<path d="M32 6 v52 M9 19 l46 26 M55 19 l-46 26" class="linha"/>
         <path d="M32 20 l-7-7 M32 20 l7-7 M32 44 l-7 7 M32 44 l7 7
                  M21 26 l-10 0 M43 38 l10 0 M43 26 l10 0 M21 38 l-10 0" class="linha"/>`,
  raio: `<path d="M38 4 L14 36 h12 L24 60 L50 26 H36z"/>`,
  cone: `<path d="M10 32 L50 10 M10 32 L50 54" class="linha"/>
         <path d="M28 20 a24 24 0 0 1 0 24 M40 14 a34 34 0 0 1 0 36" class="linha"/>
         <circle cx="10" cy="32" r="5"/>`,
  amplo: `<circle cx="32" cy="32" r="7"/>
          <path d="M32 22 V8 M32 42 v14 M22 32 H8 M42 32 h14" class="linha"/>
          <path d="M32 8 l-5 6 M32 8 l5 6 M32 56 l-5-6 M32 56 l5-6
                   M8 32 l6-5 M8 32 l6 5 M56 32 l-6-5 M56 32 l-6 5" class="linha"/>`,
  longo: `<path d="M6 44 h46" class="linha"/>
          <path d="M58 44 L44 37 v14z"/>
          <path d="M6 38 v12 M20 40 v8 M34 40 v8" class="linha"/>
          <path d="M10 22 h30" class="linha tracejado"/>`,
  dividir: `<path d="M6 32 h18" class="linha"/>
            <path d="M24 32 L42 14 M24 32 L42 50" class="linha"/>
            <path d="M56 10 L38 12 l6 10z"/>
            <path d="M56 54 L38 52 l6-10z"/>`,
  // Hexagrama: dois triângulos entrelaçados, a marca do pacto do feiticeiro.
  feitico: `<path d="M32 6 L54 44 H10z" class="linha"/>
            <path d="M32 58 L10 20 h44z" class="linha"/>`
};

/**
 * A cor entra fixa, e não em currentColor: o Foundry desenha o ícone dentro de
 * um <img>, onde o CSS da ficha não alcança.
 */
function fecharProprio(corpo) {
  const miolo = corpo
    .replace(/class="linha tracejado"/g, 'fill="none" stroke-dasharray="6 5"')
    .replace(/class="linha"/g, 'fill="none"');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="${COR}">
<g stroke="${COR}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
${miolo}
</g>
</svg>
`;
}

/* -------------------------------------------------------------------------- */
/*  Recorte do game-icons.net                                                 */
/* -------------------------------------------------------------------------- */

/** Nome do arquivo no sistema → nome do ícone no acervo. */
const DO_ACERVO = {
  // Elementos
  fogo: "fire", agua: "water-drop", vento: "whirlwind", terra: "stone-block",
  vida: "sprout", mente: "brain", morte: "death-skull", espaco: "magic-portal",
  // Formas
  projetil: "thrown-spear", explosao: "explosion-rays", linha: "ringed-beam",
  muro: "stone-wall", aura: "aura", toque: "hand",
  // Gestos
  persistente: "sands-of-time", preciso: "crosshair",
  // Tipos de item
  arma: "broadsword", equipamento: "chest-armor", consumivel: "round-potion",
  habilidade: "star-swirl", tecnica: "fist", pericia: "open-book",
  magia: "magic-swirl", runa: "rune-stone", caminho: "family-tree"
};

function fecharDoAcervo(icone, largura, altura) {
  const w = icone.width ?? largura;
  const h = icone.height ?? altura;
  /*
   * Os corpos do acervo pintam em currentColor. Dentro de um <img> isso resolve
   * para preto, então a cor vai também como propriedade, e não só como fill.
   */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="color:${COR}" fill="${COR}">${icone.body}</svg>
`;
}

/* -------------------------------------------------------------------------- */

mkdirSync(DESTINO, { recursive: true });

let escritos = 0;
for (const [nome, corpo] of Object.entries(PROPRIOS)) {
  writeFileSync(path.join(DESTINO, `${nome}.svg`), fecharProprio(corpo));
  escritos++;
}

let acervo;
try {
  acervo = require("@iconify-json/game-icons/icons.json");
} catch {
  console.log(`${escritos} próprios escritos.`);
  console.log("Acervo não instalado: os .svg já versionados ficam como estão.");
  console.log("Para regerá-los: npm i -D @iconify-json/game-icons");
  process.exit(0);
}

const faltando = [];
for (const [nome, chave] of Object.entries(DO_ACERVO)) {
  const icone = acervo.icons[chave];
  if (!icone) {
    faltando.push(`${nome} → ${chave}`);
    continue;
  }
  writeFileSync(path.join(DESTINO, `${nome}.svg`),
    fecharDoAcervo(icone, acervo.width ?? 512, acervo.height ?? 512));
  escritos++;
}

writeFileSync(path.join(DESTINO, "CREDITOS.md"), `# Créditos dos ícones

Os ícones deste sistema vêm de duas origens.

## Desenhados para o PYRO

${Object.keys(PROPRIOS).sort().map(n => `- \`${n}.svg\``).join("\n")}

Sem restrição de uso dentro do sistema.

## game-icons.net

Os demais são do acervo do [game-icons.net](https://game-icons.net), sob a
licença [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), que exige
este crédito:

> Icons made by Lorc, Delapouite and contributors — https://game-icons.net

Nome do arquivo aqui e nome no acervo, para achar o original:

${Object.entries(DO_ACERVO).map(([n, c]) => `- \`${n}.svg\` — ${c}`).join("\n")}
`);

console.log(`${escritos} ícones escritos em icons/`);
if (faltando.length) console.log("sem correspondência no acervo:", faltando.join(", "));
