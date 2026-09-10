/**
 * Percepção espiritual no canvas: os modos de detecção que sentem mana e
 * energia através das paredes, e as três aparências (modos de visão) entre as
 * quais a habilidade de sentido escolhe.
 *
 * Tudo é registrado dentro de registrarPercepcao, no init, porque as classes
 * do canvas (foundry.canvas.*) só existem com o Foundry de pé — e é só ali
 * que elas são necessárias.
 */
import { PYRO } from "./config.mjs";
import { calcularFormula } from "./dados.mjs";

/** Id do modo de detecção de um sentido: mana -> sentidoMana. */
export const idDoSentido = tipo =>
  `sentido${tipo.charAt(0).toUpperCase()}${tipo.slice(1)}`;

/** Id do modo irmão, o que sente quem NÃO carrega o recurso (o vulto sólido). */
export const idDoVazio = tipo => `${idDoSentido(tipo)}Vazio`;

/**
 * Os sentidos de um ator, um por tipo, a partir das habilidades dele.
 *
 * O alcance sai da fórmula da habilidade, com [NVL] sendo o nível dela; duas
 * habilidades com o mesmo sentido não somam — vale o maior alcance, porque
 * sentir duas vezes não faz ninguém sentir mais longe. Fórmula vazia ou que
 * dá zero descarta o sentido: um sentido de alcance nenhum não existe.
 *
 * @param {Iterable<object>} itens os itens do ator.
 * @param {object} dados os dados de rolagem do ator (getRollData).
 */
export function sentidosDoAtor(itens, dados) {
  const sentidos = {};
  for (const item of itens ?? []) {
    if (item.type !== "habilidade") continue;
    const sentido = item.system.sentido;
    if (!sentido?.tipo || !PYRO.sentidos[sentido.tipo]) continue;
    // Adormecida (Despertar) ainda não faz nada, sentido incluído.
    if (item.system.adormecidaAtiva) continue;
    const alcance = calcularFormula(sentido.alcance, {
      ...dados, nvl: Number(item.system.nivel) || 0
    });
    if (alcance <= 0) continue;
    const atual = sentidos[sentido.tipo];
    if (atual && atual.alcance >= alcance) continue;
    sentidos[sentido.tipo] = {
      alcance,
      aparencia: sentido.aparencia || "azulEtereo",
      origem: item.name
    };
  }
  return sentidos;
}

export function registrarPercepcao() {
  const { DetectionMode, VisionMode } = foundry.canvas.perception;
  const S = foundry.canvas.rendering.shaders;
  const F = foundry.canvas.rendering.filters;

  /* --- Detecção: sentir criaturas através das paredes --------------------- */
  /*
   * walls: false é o que atravessa parede; angle: false porque um sentido não
   * tem cone — mana no ar não vem de frente.
   *
   * Cada sentido vira DOIS modos, porque ele revela todo mundo e o filtro
   * visual é estático por classe: um para quem carrega o recurso (acende na
   * cor do sentido) e um para quem não carrega (o vulto sólido, escuro — o
   * buraco que a pessoa faz na mana do ar, igualzinho a uma parede).
   */
  const criarModo = ({ id, label, filtro, sente }) => {
    const modo = new (class extends DetectionMode {
      /*
       * O filtro de contorno saiu da documentação pública em versões
       * recentes, então a busca é defensiva: sem nenhum filtro disponível, o
       * token aparece sem realce — que é degradação, não erro por frame no
       * meio do jogo.
       */
      static getDetectionFilter() {
        if (this._detectionFilter !== undefined) return this._detectionFilter;
        const Contorno = F.OutlineOverlayFilter;
        if (Contorno) {
          return this._detectionFilter = Contorno.create({ outlineColor: filtro, knockout: true });
        }
        const Brilho = F.GlowOverlayFilter;
        return this._detectionFilter = Brilho
          ? Brilho.create({ glowColor: filtro }) : null;
      }

      /** @override */
      _canDetect(visionSource, target) {
        if (!(target instanceof foundry.canvas.placeables.Token)) return false;
        // Desmaiado não sente nada: o sentido é atenção, não olho aberto.
        if (visionSource.object?.document?.hasStatusEffect?.("desmaiado")) return false;
        return sente(target.actor?.system);
      }
    })({
      id,
      label,
      type: DetectionMode.DETECTION_TYPES.OTHER,
      walls: false,
      angle: false,
      // O modo vem da ficha, por dado derivado: um controle no Token Config
      // que o prepare desfaz seria um controle de mentira.
      tokenConfig: false
    });
    CONFIG.Canvas.detectionModes[modo.id] = modo;
  };

  for (const [tipo, cfg] of Object.entries(PYRO.sentidos)) {
    criarModo({
      id: idDoSentido(tipo), label: cfg.label,
      filtro: cfg.cor, sente: sys => !!cfg.brilha(sys)
    });
    criarModo({
      id: idDoVazio(tipo), label: "PYRO.Sentidos.Vazio",
      filtro: PYRO.COR_DO_VAZIO, sente: sys => !cfg.brilha(sys)
    });
  }

  /* --- Aparências: como o mundo se parece para quem sente ----------------- */
  /*
   * Três candidatas de propósito: a mesa compara olhando a cena e as que
   * sobrarem saem de PYRO.aparenciasSentido. Nenhuma escreve shader novo —
   * tudo é combinação do que o core já tem (os ajustes de cor do canvas, os
   * defaults de visão e os shaders de onda do tremorsense, aqui domados com
   * cor fria e atenuação leve em vez do cinza chapado).
   */
  const aparencias = {
    // Cena dessaturada com tinta azul fria e ondulação lenta; o brilho nas
    // pessoas vem do filtro de detecção, não daqui.
    azulEtereo: new VisionMode({
      id: "azulEtereo",
      label: "PYRO.Aparencia.azulEtereo",
      canvas: {
        shader: S.ColorAdjustmentsSamplerShader,
        uniforms: { contrast: 0.1, saturation: -0.75, exposure: 0.05 }
      },
      lighting: {
        background: {
          postProcessingModes: ["SATURATION"],
          uniforms: { saturation: -0.75, tint: [0.5, 0.65, 1] }
        },
        illumination: {
          postProcessingModes: ["SATURATION"],
          uniforms: { saturation: -0.75 }
        },
        coloration: {
          postProcessingModes: ["SATURATION"],
          uniforms: { saturation: -0.75 }
        }
      },
      vision: {
        background: { shader: S.WaveBackgroundVisionShader },
        coloration: { shader: S.WaveColorationVisionShader },
        darkness: { adaptive: false },
        defaults: { color: 0x4d79ff, attenuation: 0.25, brightness: 0.4, saturation: -0.75, contrast: 0.15 }
      }
    }, { animated: true }),

    // Mundo quase apagado, cinza escuro e parado: "eu não vejo, eu sinto".
    // Só as fontes de mana acendem, pelo contorno do modo de detecção.
    brancoBrilho: new VisionMode({
      id: "brancoBrilho",
      label: "PYRO.Aparencia.brancoBrilho",
      canvas: {
        shader: S.ColorAdjustmentsSamplerShader,
        uniforms: { contrast: 0.2, saturation: -1, exposure: -0.35 }
      },
      lighting: {
        background: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -1 } },
        illumination: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -1 } },
        coloration: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -1 } }
      },
      vision: {
        darkness: { adaptive: false },
        defaults: { color: 0xdfe8ff, attenuation: 0.4, brightness: -0.35, saturation: -1, contrast: 0.25 }
      }
    }),

    // O parente educado do tremorsense: a mesma onda, bem mais sutil, sem cor.
    ecoOnda: new VisionMode({
      id: "ecoOnda",
      label: "PYRO.Aparencia.ecoOnda",
      canvas: {
        shader: S.ColorAdjustmentsSamplerShader,
        uniforms: { contrast: 0.15, saturation: -0.9, exposure: -0.1 }
      },
      vision: {
        background: { shader: S.WaveBackgroundVisionShader },
        coloration: { shader: S.WaveColorationVisionShader },
        darkness: { adaptive: false },
        defaults: { color: 0x9db4c0, attenuation: 0.4, brightness: 0.15, saturation: -0.9, contrast: 0.3 }
      }
    }, { animated: true })
  };

  for (const modo of Object.values(aparencias)) {
    CONFIG.Canvas.visionModes[modo.id] = modo;
  }
}
