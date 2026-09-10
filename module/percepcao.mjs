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
   * Nenhuma escreve shader novo — tudo é combinação do que o core já tem: os
   * ajustes de cor do canvas, a dessaturação com tinta das camadas de luz e
   * os defaults de visão. Nada de shader de onda do tremorsense: a luz parada
   * é que pinta a área, sem tremor. Estas aparências valem para quem é cego e
   * vive dentro do sentido; para quem também enxerga, a tonalidade entra só
   * na área além da visão (o véu, mais abaixo).
   */
  const aparencias = {
    // Cena dessaturada com tinta azul fria; o brilho nas pessoas vem do
    // filtro de detecção, não daqui. Os defaults não trazem cor nem brilho de
    // propósito: a camada de coloração do Foundry é aditiva, e qualquer cor
    // ali SOMA luz — em chão claro vira disco estourado. O azul do entorno é
    // o halo desenhado pelo sistema (ver o véu, mais abaixo).
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
        darkness: { adaptive: false },
        defaults: { attenuation: 0.25, brightness: 0, saturation: -0.75, contrast: 0.1 }
      }
    }),

    // O mundo apagado do azulEtereo, mais escuro e quieto: "eu não vejo, eu
    // sinto". Sem cor de visão pelo mesmo motivo do azulEtereo.
    brancoBrilho: new VisionMode({
      id: "brancoBrilho",
      label: "PYRO.Aparencia.brancoBrilho",
      canvas: {
        shader: S.ColorAdjustmentsSamplerShader,
        uniforms: { contrast: 0.15, saturation: -1, exposure: -0.25 }
      },
      lighting: {
        background: {
          postProcessingModes: ["SATURATION"],
          uniforms: { saturation: -1, tint: [0.55, 0.65, 0.95] }
        },
        illumination: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -1 } },
        coloration: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -1 } }
      },
      vision: {
        darkness: { adaptive: false },
        defaults: { attenuation: 0.5, brightness: -0.25, saturation: -1, contrast: 0.15 }
      }
    }),

    // Neutro: cinza dessaturado com um sopro de luz fria, sem tinta azul.
    ecoOnda: new VisionMode({
      id: "ecoOnda",
      label: "PYRO.Aparencia.ecoOnda",
      canvas: {
        shader: S.ColorAdjustmentsSamplerShader,
        uniforms: { contrast: 0.15, saturation: -0.9, exposure: -0.1 }
      },
      lighting: {
        background: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -0.9 } },
        illumination: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -0.9 } },
        coloration: { postProcessingModes: ["SATURATION"], uniforms: { saturation: -0.9 } }
      },
      vision: {
        darkness: { adaptive: false },
        defaults: { attenuation: 0.4, brightness: 0, saturation: -0.9, contrast: 0.2 }
      }
    })
  };

  for (const modo of Object.values(aparencias)) {
    CONFIG.Canvas.visionModes[modo.id] = modo;
  }

  /* --- Ver o mapa através das paredes -------------------------------------- */
  /*
   * O modo de detecção revela tokens; o terreno é outro caminho — o polígono
   * de visão do token, que o Foundry sempre corta nas paredes. Aqui a fonte
   * de visão ganha um segundo polígono que ignora paredes, limitado ao
   * alcance do sentido, e o une ao normal: dentro desse raio o jogador vê o
   * mapa como quem sente a mana do ar, paredes inclusas como sólidos.
   *
   * É a única parte disto tudo sobre API protegida do Foundry (o mesmo
   * território do módulo vision-5e, de onde vem a técnica), então tudo é
   * montado em variáveis locais e só atribuído no fim: uma falha no meio
   * deixa a visão normal intacta, em vez de um polígono pela metade.
   *
   * Efeito colateral assumido: dentro do raio, a névoa explorada atravessa
   * paredes junto. O controle disso é o próprio alcance da fórmula — e, nas
   * cenas em que incomodar, desligar a exploração de névoa da cena.
   *
   * A classe estende o que estiver registrado, e não a base do Foundry:
   * módulos de visão disputam esta chave, e partir da base apagaria o que
   * outro já instalou.
   */
  CONFIG.Canvas.visionSourceClass = class extends CONFIG.Canvas.visionSourceClass {
    /**
     * Alcance do sentido em pixels, lido do token — 0 desliga tudo isto.
     * getLightRadius soma o raio do próprio corpo: num token 2x2 o sentido
     * é medido da pele para fora, como os raios de luz do core.
     */
    #raioSemParedes() {
      const alcance = this.object?.document?.alcanceEspiritual ?? 0;
      return alcance > 0 ? (this.object.getLightRadius?.(alcance)
        ?? alcance * canvas.dimensions.distancePixels) : 0;
    }

    /** @override */
    _createShapes() {
      super._createShapes();
      this.areaDoSentido = null;
      const raio = this.#raioSemParedes();
      if (!(raio > 0)) return;
      try {
        const config = this._getPolygonConfiguration();
        config.radius = Math.min(raio, this.los.config.radius ?? canvas.dimensions.maxR);
        config.edgeTypes = foundry.utils.deepClone(this.los.config.edgeTypes ?? {});
        // Parede é um tipo de edge com modo, e 0 é "não corta".
        config.edgeTypes.wall = { mode: 0, priority: -Infinity };
        const semExposure = { threshold: 0 };
        const exposureOriginal = config.surfaceExposure;
        config.surfaceExposure = semExposure;

        const polygonClass = CONFIG.Canvas.polygonBackends[this.constructor.sourceType];
        const semParedes = polygonClass.create(this.origin, config);

        /*
         * Visão normal vence o sentido: para quem enxerga, o los vira a
         * união (visão + círculo do sentido), e só o que a visão com paredes
         * NÃO cobre ganha a tonalidade espiritual — a diferença é guardada
         * para o véu desenhar no sightRefresh. O cego é outro caso: o mundo
         * dele É o círculo do sentido, e só ele — sem união com o los de
         * visão, uma cena com luz global não entrega o mapa inteiro a quem
         * não vê. Fora do alcance não existe nada.
         */
        const cego = Object.hasOwn(aparencias, this.object?.document?.sight?.visionMode ?? "");
        let final = semParedes;
        if (!cego) {
          final = semParedes.intersectPolygon(this.los, {
            clipType: ClipperLib.ClipType.ctUnion,
            scalingFactor: CONST.CLIPPER_SCALING_FACTOR
          });
          this.areaDoSentido = subtrairPoligono(semParedes, this.los);
        }

        // Só agora o los muda, com tudo já calculado: a exposure de
        // superfície (Levels) é refeita sobre o polígono novo, senão a
        // visibilidade por elevação seria testada contra a área antiga.
        this.los.points = final.points;
        this.los.bounds = this.los.getBounds();
        this.los.config.surfaceExposure = exposureOriginal;
        this.los.surfaceExposure = foundry.canvas.geometry.ElevatedSurfaceExposureGenerator
          .compute(this.los, exposureOriginal);

        // O campo de visão e a luz foram cortados pelo polígono antigo; com o
        // los alargado, os dois precisam nascer de novo.
        this.light = this._createLightPolygon();
        this.shape = this._createRestrictedPolygon();
      } catch (erro) {
        console.error("PYRO | O polígono sem paredes do sentido espiritual falhou; ficou a visão normal.", erro);
      }
    }
  };

  /* --- O véu: a tonalidade do sentido onde a visão não chega ---------------- */
  /*
   * Um modo de visão pinta a fonte inteira, e para quem enxerga isso tingia
   * até a visão direta. O véu é o caminho do meio: um Graphics translúcido
   * desenhado só sobre a área que apenas o sentido cobre, logo acima do grupo
   * de visibilidade — acima da névoa, abaixo da interface (grade, bordas de
   * token). A área já é a parte visível do los, então ficar fora da máscara
   * de visão não vaza nada.
   *
   * O mesmo Graphics desenha o halo do cego: o azul no entorno do alcance,
   * como degradê que nasce transparente no centro. É desenhado aqui, e não
   * pela cor de visão do Foundry, porque a camada de coloração é aditiva —
   * cor lá soma luz e estoura chão claro; o halo só tinge.
   */
  const COR_DO_VEU = 0x8fa0b8;
  const ALFA_DO_VEU = 0.4;
  const COR_DO_HALO = [77, 121, 255];
  const TAM_HALO = 512;

  let texturaDoHalo = null;
  const criarTexturaDoHalo = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = TAM_HALO;
    const ctx = cv.getContext("2d");
    const meio = TAM_HALO / 2;
    const grad = ctx.createRadialGradient(meio, meio, 0, meio, meio, meio);
    const [r, g, b] = COR_DO_HALO;
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.1)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.55)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TAM_HALO, TAM_HALO);
    return PIXI.Texture.from(cv);
  };

  const desenharHalo = (veu, fonte) => {
    const objeto = fonte.object;
    const alcance = objeto?.document?.alcanceEspiritual ?? 0;
    if (!(alcance > 0) || !fonte.los) return;
    // O mesmo raio em pixels do polígono sem paredes: o los do cego é
    // exatamente este círculo, então a textura cobre o polígono inteiro e
    // não se repete (textura repetida vira um padrão de bolhas na cena).
    const raio = objeto.getLightRadius?.(alcance)
      ?? alcance * canvas.dimensions.distancePixels;
    if (!(raio > 0)) return;
    texturaDoHalo ??= criarTexturaDoHalo();
    const { x, y } = fonte.origin ?? fonte;
    const matriz = new PIXI.Matrix()
      .scale((2 * raio) / TAM_HALO, (2 * raio) / TAM_HALO)
      .translate(x - raio, y - raio);
    veu.beginTextureFill({ texture: texturaDoHalo, matrix: matriz });
    veu.drawPolygon(fonte.los);
    veu.endFill();
  };

  /**
   * a - b como peças prontas para desenhar: contorno + buracos (o los inteiro
   * dentro do círculo do sentido vira um anel, e o miolo é buraco de verdade).
   * A PolyTree preserva essa hierarquia; sem o conversor dela, cada caminho
   * vira contorno — o anel pinta o miolo junto, feio mas inofensivo.
   */
  const subtrairPoligono = (a, b) => {
    const fator = CONST.CLIPPER_SCALING_FACTOR;
    const clipper = new ClipperLib.Clipper();
    clipper.AddPath(a.toClipperPoints({ scalingFactor: fator }), ClipperLib.PolyType.ptSubject, true);
    clipper.AddPath(b.toClipperPoints({ scalingFactor: fator }), ClipperLib.PolyType.ptClip, true);
    const arvore = new ClipperLib.PolyTree();
    clipper.Execute(ClipperLib.ClipType.ctDifference, arvore,
      ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const daClipper = pontos =>
      new PIXI.Polygon(pontos.flatMap(p => [p.X / fator, p.Y / fator]));
    const pecas = ClipperLib.JS?.PolyTreeToExPolygons?.(arvore)
      ?? ClipperLib.Clipper.PolyTreeToPaths(arvore).map(c => ({ outer: c, holes: [] }));
    return pecas.map(p => ({
      contorno: daClipper(p.outer),
      buracos: (p.holes ?? []).map(daClipper)
    }));
  };

  const desenharVeu = veu => {
    veu.clear();
    for (const fonte of canvas.effects.visionSources) {
      if (!fonte.active) continue;
      // O cego, com a cena inteira na aparência do sentido, ganha o halo azul
      // no entorno em vez do véu cinza.
      if (Object.hasOwn(aparencias, fonte.object?.document?.sight?.visionMode ?? "")) {
        desenharHalo(veu, fonte);
        continue;
      }
      if (!fonte.areaDoSentido?.length) continue;
      for (const peca of fonte.areaDoSentido) {
        veu.beginFill(COR_DO_VEU, ALFA_DO_VEU);
        veu.drawPolygon(peca.contorno);
        for (const buraco of peca.buracos) {
          veu.beginHole();
          veu.drawPolygon(buraco);
          veu.endHole();
        }
        veu.endFill();
      }
    }
  };

  // O véu renasce a cada cena: o tearDown do canvas leva os filhos embora.
  let veu = null;
  Hooks.on("canvasReady", () => {
    const pai = canvas.visibility?.parent;
    if (!pai) return;
    veu = pai.addChildAt(new PIXI.Graphics(), pai.getChildIndex(canvas.visibility) + 1);
    veu.eventMode = "none";
    // A visão inicial da cena pode ter se refeito antes do véu existir.
    desenharVeu(veu);
  });
  Hooks.on("canvasTearDown", () => {
    if (veu && !veu.destroyed) veu.destroy();
    veu = null;
  });
  Hooks.on("sightRefresh", () => {
    if (veu && !veu.destroyed) desenharVeu(veu);
  });

  /* --- Invalidação: mudou o sentido, o canvas refaz a visão ---------------- */
  /*
   * O dado do token é derivado e recalcula sozinho, mas a fonte de visão já
   * desenhada não se refaz sem este empurrão. O alcance depende da habilidade
   * E dos dados do ator (a fórmula lê atributos), então efeitos e edições do
   * ator também contam. Roda em todos os clientes de propósito: cada um
   * atualiza a própria percepção.
   */
  const refazerVisao = () => {
    if (!canvas?.ready) return;
    canvas.perception.update({ initializeVision: true });
  };
  const temSentidos = actor =>
    actor instanceof Actor && !foundry.utils.isEmpty(actor.system?.sentidos ?? {});

  Hooks.on("updateItem", (doc, changed) => {
    if (doc?.type !== "habilidade") return;
    // Só o que mexe no sentido: renomear a habilidade não refaz cena nenhuma.
    const relevante = changed.system && ("sentido" in changed.system
      || "nivel" in changed.system || "adormecida" in changed.system);
    if (!relevante) return;
    if (doc.system?.sentido?.tipo || temSentidos(doc.parent)) refazerVisao();
  });
  for (const gancho of ["createItem", "deleteItem"]) {
    Hooks.on(gancho, doc => {
      if (doc?.type !== "habilidade" || !doc.system?.sentido?.tipo) return;
      if (doc.parent instanceof Actor) refazerVisao();
    });
  }
  Hooks.on("updateActor", actor => { if (temSentidos(actor)) refazerVisao(); });
  for (const gancho of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(gancho, doc => {
      const actor = doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent;
      if (temSentidos(actor)) refazerVisao();
    });
  }
}