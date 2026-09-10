/**
 * Regiões de densidade espiritual: uma região da cena diz quanta mana ou
 * energia há no ar dali, e isso multiplica a recuperação por cena do recurso
 * e o alcance do sentido espiritual.
 *
 * A densidade é LIDA na hora em que o número é preciso, e não aplicada como
 * efeito no ator: sem estado duplicado não há efeito órfão quando alguém
 * arrasta um token com o jogo fechado, nem duas cópias criadas por dois
 * clientes. O comportamento de região só avisa o canvas quando alguém entra
 * ou sai, para a visão se refazer.
 */
import { PYRO } from "./config.mjs";

/** O tipo do comportamento de região, como declarado em system.json. */
export const TIPO_DENSIDADE = "densidadeEspiritual";

/**
 * A densidade que vale para um token, para um recurso: a mais restritiva
 * entre as regiões em que ele está (a de menor ordem). Fora de qualquer
 * região, ou num token que nem está em cena, a mana do ar é a normal.
 * @param {object|null} tokenDoc TokenDocument, ou null.
 * @param {"mana"|"energia"} recurso
 * @returns {string} chave de PYRO.densidades.
 */
export function densidadeDoToken(tokenDoc, recurso) {
  let escolhida = null;
  for (const regiao of tokenDoc?.regions ?? []) {
    for (const behavior of regiao.behaviors ?? []) {
      if (behavior.type !== TIPO_DENSIDADE || behavior.disabled) continue;
      const sys = behavior.system;
      if (sys.recurso !== "ambos" && sys.recurso !== recurso) continue;
      const cfg = PYRO.densidades[sys.densidade];
      if (!cfg) continue;
      if (!escolhida || cfg.ordem < PYRO.densidades[escolhida].ordem) {
        escolhida = sys.densidade;
      }
    }
  }
  return escolhida ?? "normal";
}

/** Multiplicador de alcance do sentido para este token, neste recurso. */
export function multAlcanceDoToken(tokenDoc, recurso) {
  return PYRO.densidades[densidadeDoToken(tokenDoc, recurso)]?.multAlcance ?? 1;
}

/**
 * Multiplicador de recuperação por cena de um recurso do ator, pela região em
 * que o token ativo dele está. Sem token em cena não há região, e a
 * recuperação é a normal — a cena "fora do mapa" não pune ninguém.
 */
export function multRecuperacaoDoAtor(actor, recurso) {
  // getDependentTokens acha o token independente de vínculo e de qual cena o
  // cliente está olhando; num ator sintético ele devolve o próprio token.
  const token = actor?.getDependentTokens?.({ concreteOnly: true })[0] ?? null;
  return PYRO.densidades[densidadeDoToken(token, recurso)]?.multRecuperacao ?? 1;
}

/**
 * Um valor multiplicado pela densidade, arredondado para baixo mas nunca a
 * zero enquanto a densidade existir: "escassa" corta pela metade, e só
 * "nenhuma" apaga — senão as duas seriam indistinguíveis nos números pequenos.
 */
export function comDensidade(valor, fator) {
  if (fator <= 0 || valor <= 0) return 0;
  return Math.max(1, Math.floor(valor * fator));
}

/* -------------------------------------------------------------------------- */

export function registrarRegioes() {
  const fields = foundry.data.fields;

  /**
   * O comportamento em si. Os campos aparecem sozinhos na ficha da região
   * (o Foundry desenha o schema), e o efeito mecânico mora nas funções de
   * leitura acima — o handler de evento só refaz a visão de quem olha.
   */
  class DensidadeEspiritualBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
    /** Rótulos dos campos: PYRO.Densidade.FIELDS.<campo>.label no idioma. */
    static LOCALIZATION_PREFIXES = ["PYRO.Densidade"];

    static defineSchema() {
      return {
        recurso: new fields.StringField({
          required: true,
          initial: "ambos",
          choices: () => Object.fromEntries(Object.entries(PYRO.recursosDeDensidade)
            .map(([k, label]) => [k, game.i18n.localize(label)]))
        }),
        densidade: new fields.StringField({
          required: true,
          initial: "normal",
          choices: () => Object.fromEntries(Object.entries(PYRO.densidades)
            .map(([k, cfg]) => [k, game.i18n.localize(cfg.label)]))
        })
      };
    }

    /** @override */
    events = new Set([CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT]);

    /** @override */
    async _handleRegionEvent(event) {
      /*
       * A densidade nova muda o alcance do sentido, que é dado derivado do
       * token: o reset refaz a conta e o canvas redesenha a visão. Roda em
       * todos os clientes de propósito — cada um cuida da própria percepção,
       * e nada aqui escreve no banco. Token de outra cena (ou recém-apagado,
       * que também dispara a saída) não refaz nada por aqui.
       */
      const token = event.data?.token;
      if (!token || token.parent !== canvas?.scene) return;
      token.reset();
      // A ficha aberta anuncia a recuperação por cena com a densidade nova.
      if (token.actor?.sheet?.rendered) token.actor.sheet.render();
      canvas.perception.update({ initializeVision: true });
    }
  }

  (CONFIG.RegionBehavior.dataModels ??= {})[TIPO_DENSIDADE] = DensidadeEspiritualBehavior;
  (CONFIG.RegionBehavior.typeIcons ??= {})[TIPO_DENSIDADE] = "fa-solid fa-droplet";

  /*
   * Editar a densidade de uma região com gente dentro não dispara evento
   * nenhum de entrada ou saída — quem já está lá ficaria com o alcance velho
   * até se mexer.
   */
  Hooks.on("updateRegionBehavior", behavior => {
    if (behavior?.type !== TIPO_DENSIDADE || !canvas?.ready) return;
    for (const token of behavior.region?.tokens ?? []) {
      if (token.parent !== canvas.scene) continue;
      token.reset();
      if (token.actor?.sheet?.rendered) token.actor.sheet.render();
    }
    canvas.perception.update({ initializeVision: true });
  });

  /*
   * Na primeira pintura da cena, o conjunto de regiões de cada token pode ter
   * chegado depois da preparação dele: o reset garante que quem deu F5 dentro
   * da cripta sem mana acorda sem o sentido, e não com o alcance cheio.
   */
  Hooks.on("canvasReady", () => {
    for (const token of canvas.scene?.tokens ?? []) {
      if (!foundry.utils.isEmpty(token.actor?.system?.sentidos ?? {})) token.reset();
    }
  });
}
