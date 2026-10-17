/**
 * Técnicas básicas: Atacar, Esquivar e Bloquear.
 *
 * Todo personagem e todo NPC tem as três, e é só por elas que se golpeia com
 * arma e se reage. Nascem no nível 0 com um único traço no grau 1 (Potência,
 * Evasão, Guarda), e esse traço é o único que sobe: são a régua com que a
 * mesa compara as técnicas próprias, e uma base que vira outra técnica deixa
 * de servir de régua.
 *
 * Com Esforço 0 a técnica é o golpe ou a reação comum, sem estamina. O
 * Esforço é que liga o traço.
 */
import { PYRO } from "./config.mjs";

/** Quem luta recebe as básicas. O grupo é uma ficha de inventário comum. */
export const TIPOS_COM_BASICAS = ["personagem", "npc"];

/** O item é uma técnica básica? */
export const ehBasica = item => item?.type === "tecnica" && !!item.system?.basica;

/** A técnica básica `chave` do ator, ou null quando ele não a tem. */
export function tecnicaBasica(actor, chave) {
  return actor?.items?.find(i => i.type === "tecnica" && i.system.basica === chave) ?? null;
}

/** O único traço que a básica tem e pode subir. */
export const tracoDaBasica = chave => PYRO.tecnicasBasicas[chave]?.traco ?? null;

/** Dados de criação de uma básica, no estado em que todo mundo a recebe. */
export function dadosDaBasica(chave) {
  const cfg = PYRO.tecnicasBasicas[chave];
  return {
    name: game.i18n.localize(cfg.nome),
    type: "tecnica",
    img: cfg.img,
    system: {
      basica: chave,
      acaoBase: chave,
      // Atacar cobra as ações da arma escolhida; o número aqui só vale nas
      // de reação, que custam uma.
      acoes: PYRO.acoesBaseTecnica[chave]?.reacao ? 1 : 2,
      especificidade: "nenhuma",
      tracos: [{ chave: cfg.traco, grau: 1 }],
      progresso: { nivel: 0 }
    }
  };
}

/**
 * Básicas que faltam numa lista de itens em forma de dados (a fonte do ator
 * antes de ele existir, ou os itens de um ator que já existe).
 */
export function basicasQueFaltam(tipoDoAtor, itens = []) {
  if (!TIPOS_COM_BASICAS.includes(tipoDoAtor)) return [];
  const tem = new Set(itens
    .filter(i => i?.type === "tecnica")
    .map(i => i.system?.basica)
    .filter(Boolean));
  return Object.keys(PYRO.tecnicasBasicas).filter(chave => !tem.has(chave));
}

/** Dá ao ator as básicas que faltam. Só o GM cria, para não sair em dobro. */
export async function completarBasicas(actor) {
  const faltam = basicasQueFaltam(actor?.type, actor?.items?.contents ?? []);
  if (!faltam.length) return [];
  return actor.createEmbeddedDocuments("Item", faltam.map(dadosDaBasica));
}

/**
 * Fichas que já existiam antes das básicas, ou que perderam uma por um
 * caminho que não passa pela ficha (importação, compêndio editado à mão),
 * são completadas quando o GM abre o mundo.
 */
export function registrarTecnicasBasicas() {
  Hooks.once("ready", async () => {
    if (!game.user.isGM) return;
    for (const actor of game.actors) {
      await completarBasicas(actor)
        .catch(erro => console.error(`PYRO | falha ao dar as técnicas básicas a ${actor.name}`, erro));
    }
  });
}
