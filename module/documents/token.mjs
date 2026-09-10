/**
 * Documento de token: traduz os sentidos espirituais do ator em visão e
 * detecção do token, como dado derivado — nada disso é gravado, e mexer na
 * habilidade que dá o sentido já muda o token junto.
 */
import { idDoSentido, idDoVazio } from "../percepcao.mjs";
import { multAlcanceDoToken, comDensidade } from "../regioes.mjs";

export class PyroTokenDocument extends TokenDocument {
  /**
   * Os sentidos do ator já com a densidade da região aplicada ao alcance:
   * onde a mana do ar é abundante o sentido vai mais longe, e onde não há
   * mana nenhuma ele some — o cego fica de fato cego ali.
   */
  #sentidosNaRegiao() {
    const ajustados = {};
    for (const [tipo, sentido] of Object.entries(this.actor?.system?.sentidos ?? {})) {
      const alcance = comDensidade(sentido.alcance, multAlcanceDoToken(this, tipo));
      if (alcance > 0) ajustados[tipo] = { ...sentido, alcance };
    }
    return ajustados;
  }

  /** @override */
  _prepareDetectionModes() {
    const sentidos = this.#sentidosNaRegiao();
    // Sem visão ligada não há fonte de percepção nenhuma neste token, e o
    // sentido não tem por onde entrar.
    const aplicar = this.sight.enabled && !foundry.utils.isEmpty(sentidos);

    /*
     * O raio e a aparência entram ANTES do super: é ele quem monta o modo de
     * visão básico a partir de sight.range, e mexer depois deixaria a visão
     * normal presa no raio antigo.
     */
    const principal = aplicar
      ? Object.values(sentidos).sort((a, b) => b.alcance - a.alcance)[0] : null;
    // A fonte de visão lê daqui o raio em que o polígono ignora paredes: o
    // sentido enxerga o mapa, não só as criaturas (ver percepcao.mjs).
    this.alcanceEspiritual = principal?.alcance ?? 0;
    const aparencia = principal ? CONFIG.Canvas.visionModes[principal.aparencia] : null;
    if (aparencia) {
      // Quem sente é assim que enxerga o mundo, e o raio de visão acompanha o
      // do sentido para o jogador ver até onde ele alcança. Raio configurado
      // maior continua valendo, e null é visão sem limite — não se encolhe
      // nenhum dos dois: um vidente com o sentido não fica míope.
      this.sight.visionMode = aparencia.id;
      for (const chave of ["color", "attenuation", "brightness", "saturation", "contrast"]) {
        if (aparencia.vision.defaults[chave] !== undefined) {
          this.sight[chave] = aparencia.vision.defaults[chave];
        }
      }
      if (this.sight.range !== null) {
        this.sight.range = Math.max(Number(this.sight.range) || 0, principal.alcance);
      }
    }

    super._prepareDetectionModes();

    if (!aplicar) return;
    for (const [tipo, sentido] of Object.entries(sentidos)) {
      // O par inteiro: quem carrega o recurso acende, quem não carrega é o
      // vulto sólido — o sentido revela os dois, no mesmo alcance.
      for (const modo of [idDoSentido(tipo), idDoVazio(tipo)]) {
        if (!CONFIG.Canvas.detectionModes[modo]) continue;
        this.detectionModes[modo] = { enabled: true, range: sentido.alcance };
      }
    }
  }
}
