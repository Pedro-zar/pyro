/**
 * Documento de token: traduz os sentidos espirituais e a luz do ator em visão,
 * detecção e iluminação do token, como dado derivado — nada disso é gravado, e
 * mexer na habilidade ou no efeito que dá o sentido (ou acende a luz) já muda o
 * token junto.
 */
import { idDoSentido, idDoVazio } from "../percepcao.mjs";
import { multAlcanceDoToken, comDensidade } from "../regioes.mjs";

export class PyroTokenDocument extends TokenDocument {
  prepareBaseData() {
    super.prepareBaseData();
    this.#acenderLuz();
  }

  /**
   * Luz que o ator emite (a tocha equipada, a magia de luz) acesa no token.
   *
   * Os dois raios são absolutos, como os do Foundry: normal é onde se enxerga
   * e penumbra é até onde a luz chega fraca — normal 6 com penumbra 12 é uma
   * tocha, e o anel de penumbra vai dos 6 aos 12 metros.
   *
   * A luz do token nunca é apagada por aqui, só aumentada: um token desenhado
   * com lanterna própria continua com ela, e o efeito só empurra o raio para
   * cima se for maior. Apagar seria decidir, por um efeito de +3 de penumbra,
   * que a lanterna do cenário não existe.
   */
  #acenderLuz() {
    // Token configurado como fonte de escuridão: ali o raio é de sombra, e
    // somar a tocha nele deixaria o escuro maior em vez de acender.
    if (this.light?.negative) return;
    const luz = this.actor?.system?.luz;
    if (!luz) return;
    const normal = Math.max(0, Number(luz.normal) || 0);
    // O ator já entrega a penumbra acertada (ver CriaturaData); o piso é
    // repetido aqui porque quem acende é este documento, e ele não deve
    // depender de outro ter feito a conta para não apagar a luz por engano.
    const penumbra = Math.max(normal, Math.max(0, Number(luz.penumbra) || 0));
    if (!penumbra) return;
    /*
     * O piso é a luz GRAVADA no token, e não a que está na instância: assim a
     * conta pode ser refeita quantas vezes for e o raio ainda encolhe quando o
     * efeito acaba. Lendo a instância, um preparo sem reinicializar deixaria a
     * luz presa no maior valor que ela já teve — a tocha apagaria e a luz
     * continuaria acesa.
     */
    const base = this._source?.light ?? this.light;
    this.light.bright = Math.max(Number(base.bright) || 0, normal);
    this.light.dim = Math.max(Number(base.dim) || 0, penumbra);
  }

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

  /**
   * A percepção de luz deste token foi desligada de propósito? Sem entrada
   * configurada o core adiciona percepção de luz sem limite no prepare, então
   * o token padrão (raio 0, nada marcado) enxerga o que estiver iluminado —
   * raio 0 sozinho não é cegueira. Antes do super, detectionModes ainda é só
   * o que foi configurado no token.
   */
  #semPercepcaoDeLuz() {
    const modos = this.detectionModes ?? {};
    const luz = Array.isArray(modos)
      ? modos.find(m => m?.id === "lightPerception") : modos.lightPerception;
    if (!luz) return false;
    return luz.enabled === false || (luz.range !== null && !(Number(luz.range) > 0));
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
    /*
     * Visão normal vence o sentido: quem enxerga continua vendo em cor
     * verdadeira, e só a área que a visão não cobre (atrás de parede) ganha o
     * véu do sentido, pintado pela fonte de visão (percepcao.mjs). A aparência
     * só toma a tela inteira para quem não enxerga nada sozinho — o mundo do
     * cego É o sentido. E cego é literal: percepção de luz zerada no token E
     * sem raio de visão no escuro (null é visão sem limite, não cegueira).
     */
    const cego = this.#semPercepcaoDeLuz()
      && this.sight.range !== null && !(Number(this.sight.range) > 0);
    if (aparencia && cego) {
      this.sight.visionMode = aparencia.id;
      for (const chave of ["color", "attenuation", "brightness", "saturation", "contrast"]) {
        if (aparencia.vision.defaults[chave] !== undefined) {
          this.sight[chave] = aparencia.vision.defaults[chave];
        }
      }
    }
    if (principal && this.sight.range !== null) {
      // O raio de visão acompanha o do sentido para o jogador ver até onde
      // ele alcança. Raio configurado maior continua valendo, e visão sem
      // limite não se encolhe: um vidente com o sentido não fica míope.
      this.sight.range = Math.max(Number(this.sight.range) || 0, principal.alcance);
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
