/**
 * Documento de item: nomes derivados, consistência de caminho/habilidade/runa
 * nos hooks de criação e edição, e o "usar" de cada tipo (cards do chat).
 */
import { PYRO } from "../config.mjs";
import { conjurarMagiaSalva, scalingsPadrao } from "../magia.mjs";
import { executarTecnica } from "../tecnica.mjs";
import { formulaTeste, formulaPool, expandirAtributos } from "../dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, ajustesDeAtributo, ajustesDeCusto, custoAjustado
} from "../efeitos.mjs";
import { esc, enriquecer, formularioDoAtor } from "../ui.mjs";
import {
  camposDeTeste, aplicarExaustaoNoTeste, aplicarVontadeNoTeste, valorComInspiracao, htmlVontadeGasta
} from "../teste.mjs";
import { flagsDoSistema } from "../sistema.mjs";

/**
 * Distância em metros entre o token do ator e o alvo marcado (se houver).
 * Retorna null quando não dá pra medir (sem token ou sem alvo).
 */
export function distanciaAteAlvo(actor) {
  try {
    const origem = actor?.getActiveTokens(true)[0];
    const alvo = game.user.targets.first();
    if (!origem || !alvo || origem === alvo) return null;
    const medida = canvas.grid.measurePath([origem.center, alvo.center]);
    return Math.round(medida.distance);
  } catch (e) {
    console.warn("PYRO | Não foi possível medir a distância até o alvo", e);
    return null;
  }
}

/** Nome automático de um caminho: "Caminho do <raça ou profissão>". */
export function nomeDoCaminho(sys) {
  let base;
  if (sys.ehRacial) {
    base = PYRO.racas[sys.raca]
      ? PYRO.nomeDaRaca(sys.raca, sys.racaDetalhe || game.i18n.localize("PYRO.Item.SemDetalhe"))
      : (sys.racaDetalhe || "");
  } else {
    base = sys.nomeCaminho || "";
  }
  base = base.trim();
  if (!base) base = game.i18n.localize("PYRO.Item.SemDetalhe");
  return game.i18n.format("PYRO.CaminhoNome", { nome: base });
}

/** Nome automático de uma runa: a palavra/gesto, ou o tipo como reserva. */
export function nomeDaRuna(sys) {
  const palavra = (sys.palavra ?? "").trim();
  if (palavra) return palavra;
  if (sys.tipoRuna === "elemento") {
    const cfg = PYRO.elementos[sys.subtipo];
    if (cfg) return game.i18n.localize(cfg.label);
  }
  return game.i18n.localize(PYRO.tiposRuna[sys.tipoRuna] ?? "TYPES.Item.runa");
}

export class PyroItem extends Item {
  /** Cabeçalho padrão dos cards do chat: ícone, nome e linha de contexto. */
  #topoHTML(meta) {
    return `<header class="pyro-item-topo">
      <img src="${this.img}" alt="" />
      <div>
        <h3>${esc(this.name)}</h3>
        ${meta ? `<span class="pyro-item-meta">${meta}</span>` : ""}
      </div>
    </header>`;
  }

  /** Runas criadas num ator nascem na língua nativa dele (elfo -> élfica). */
  async _preCreate(data, options, user) {
    const permitido = await super._preCreate(data, options, user);
    if (permitido === false) return false;

    /*
     * Ícone do tipo, quando ninguém escolheu um. O Foundry dá a mesma sacola a
     * tudo que nasce, e uma lista de vinte itens com o mesmo desenho não diz
     * nada. Item vindo de compêndio ou duplicado já traz o seu e passa direto.
     */
    const padraoDoTipo = PYRO.iconePorTipo[this.type];
    if (padraoDoTipo && (!data.img || data.img === this.constructor.DEFAULT_ICON)) {
      this.updateSource({ img: PYRO.icone(padraoDoTipo) });
    }
    if (this.type === "runa" && this.actor) {
      const alteracoes = {};
      if (!data.system?.lingua) {
        alteracoes["system.lingua"] = this.actor.system.linguaNativa ?? "humana";
      }
      // Elemento nasce num que o personagem tem afinidade, não no fogo fixo.
      const afinidades = this.actor.system.afinidadesElementos ?? [];
      if (this.system.tipoRuna === "elemento" && !data.system?.subtipo
        && afinidades.length && !afinidades.includes(this.system.subtipo)) {
        alteracoes["system.subtipo"] = afinidades[0];
      }
      if (!foundry.utils.isEmpty(alteracoes)) this.updateSource(alteracoes);
      /*
       * Runa criada em branco pela ficha chega com o nome genérico do tipo, e
       * aí vira o nome do elemento ("Raio"). Runa vinda do compêndio ou de
       * outra ficha mantém o nome que já tem: é por ele que o sistema
       * reconhece os gestos com regra (Toque, Longo, Dividir).
       */
      if (!data.name || data.name === game.i18n.localize("TYPES.Item.runa")) {
        this.updateSource({ name: nomeDaRuna(this.system) });
      }
      // Já nasce com o que as regras dão para aquele elemento ou gesto.
      if (!data.system?.scalings?.length) {
        const sys = this.system;
        this.updateSource({ "system.scalings": scalingsPadrao(sys.tipoRuna, sys.subtipo) });
      }
      // Elementos de Subjulgar (Morte) nascem com o modo ligado.
      if (data.system?.subjulgar === undefined && this.system.tipoRuna === "elemento"
        && PYRO.elementos[this.system.subtipo]?.subjulgar) {
        this.updateSource({ "system.subjulgar": true });
      }
    }
    if (this.type === "caminho") {
      if (!data.name?.trim()) this.updateSource({ name: nomeDoCaminho(this.system) });
      // Caminho vindo de compêndio ou duplicado pode trazer tamanho fora da
      // faixa da raça: encaixa já na criação.
      if (this.system.ehRacial) {
        const ajustado = PYRO.tamanhoNaFaixa(this.system.raca, this.system.tamanho);
        if (ajustado !== this.system.tamanho) this.updateSource({ "system.tamanho": ajustado });
        const exato = PYRO.tamanhoExatoNaFaixa(ajustado, this.system.tamanhoExato);
        if (exato !== this.system.tamanhoExato) this.updateSource({ "system.tamanhoExato": exato });
      }
    }
    if (this.type === "runa" && data.system?.palavra) {
      this.updateSource({ name: nomeDaRuna(this.system) });
    }
  }

  /** Caminho novo num ator já nasce com a habilidade base dele. */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    // Só o cliente que criou monta a habilidade, senão duplica.
    if (userId !== game.user.id || this.type !== "caminho" || !this.actor) return;
    await Item.implementation.create({
      name: game.i18n.localize("PYRO.Item.HabilidadeBase"),
      type: "habilidade",
      system: { caminho: this.id, tier: 1, ehBase: true }
    }, { parent: this.actor });
  }

  /**
   * Caminhos têm nome derivado (raça/profissão) e, ao trocar de raça,
   * herdam o preset de potencial mágico e as marcações de magia/feitiçaria.
   */
  async _preUpdate(changed, options, user) {
    const permitido = await super._preUpdate(changed, options, user);
    if (permitido === false) return false;

    const sys = changed.system ?? {};

    // Runa: o nome acompanha a palavra/gesto.
    if (this.type === "runa" && ("palavra" in sys || "tipoRuna" in sys || "subtipo" in sys)) {
      const projecao = foundry.utils.mergeObject(this.system.toObject(), sys, { inplace: false });
      changed.name = nomeDaRuna(projecao);
      /*
       * Trocar o elemento não mexe nas Intenções que já estão escritas. Elas
       * são trabalho de quem montou a runa, e apagá-las por causa de uma troca
       * de elemento já custou perder ajustes feitos à mão — quem quiser os
       * números do elemento novo usa o botão de restaurar o padrão.
       *
       * Runa que ainda não tem Intenção nenhuma ganha as do elemento novo: aí
       * não há o que perder, e é o que faz uma runa em branco ser útil.
       */
      const mudouNatureza = ("tipoRuna" in sys && sys.tipoRuna !== this.system.tipoRuna)
        || ("subtipo" in sys && sys.subtipo !== this.system.subtipo);
      if (mudouNatureza && !(this.system.scalings ?? []).length) {
        sys.scalings = scalingsPadrao(projecao.tipoRuna, projecao.subtipo);
        changed.system = sys;
      }
    }

    /*
     * Arma à distância: o alcance máximo nunca fica abaixo do menor. Máximo
     * zero é corpo a corpo, e aí o menor é o alcance da arma (um bastão chega
     * a 1m) — a correção não vale para esse caso, senão toda arma de mão
     * viraria arma de arremesso ao ser editada.
     */
    if (this.type === "arma" && ("alcanceMenor" in sys || "alcanceMaximo" in sys)) {
      const menor = sys.alcanceMenor ?? this.system.alcanceMenor;
      const maximo = sys.alcanceMaximo ?? this.system.alcanceMaximo;
      if (maximo > 0 && menor > maximo) sys.alcanceMaximo = menor + 1;
      changed.system = sys;
    }

    /*
     * Técnica: a arma escolhida traz junto o custo em ações dela, que é a base
     * da conta de pontos. Guardar o número aqui, e não ler a arma toda vez,
     * mantém a técnica fechando a conta depois que a arma sai da ficha, e numa
     * técnica que vive fora de um personagem.
     *
     * Por isso o retrato só é refeito quando há uma arma para retratar: apagar
     * a arma, arrastar a técnica para o diretório ou abri-la num compêndio não
     * pode apagar pontos que já estavam contados. Quem zera é escolher "sem
     * arma" no seletor, que é uma decisão de quem edita.
     */
    if (this.type === "tecnica" && "ataque" in sys) {
      const id = sys.ataque.id ?? this.system.ataque.id;
      const arma = id ? this.actor?.items?.get(id) : null;
      if (!id) sys.ataque = { ...sys.ataque, nome: "", acoes: 0 };
      else if (arma?.type === "arma") {
        sys.ataque = { ...sys.ataque, nome: arma.name, acoes: Math.max(1, arma.system.acoes ?? 2) };
      }
      changed.system = sys;
    }

    if (this.type !== "caminho") return;

    if (sys.raca && sys.raca !== this.system.raca) {
      const preset = PYRO.racas[sys.raca];
      if (preset) {
        sys.potencial = preset.potencial;
        sys.recursos = [...(preset.recursos ?? [])];
        if (preset.custom) {
          // Raça aberta: o jogador decide nas checkboxes.
          sys.usaMagia ??= preset.magia;
          sys.usaFeiticaria ??= preset.feiticos;
        } else {
          // Raça fechada: o preset manda (as checkboxes ficam ocultas).
          sys.usaMagia = preset.magia;
          sys.usaFeiticaria = preset.feiticos;
        }
        changed.system = sys;
      }
    }

    /*
     * O tamanho fica dentro da faixa da raça. Trocar um Demi-Humano gigante
     * para Humano puxa o valor para Médio, em vez de deixar gravado um tamanho
     * que o dropdown nem oferece mais. Vale também para ficha antiga, que se
     * corrige na primeira edição.
     */
    const ehRacial = sys.ehRacial ?? this.system.ehRacial;
    if (ehRacial) {
      const raca = sys.raca ?? this.system.raca;
      const tamanho = sys.tamanho ?? this.system.tamanho;
      const ajustado = PYRO.tamanhoNaFaixa(raca, tamanho);
      if (ajustado !== tamanho) {
        sys.tamanho = ajustado;
        changed.system = sys;
      }
      /*
       * O número exato acompanha o tamanho: entrando em massivo ou colossal
       * ele nasce no mínimo do degrau e fica preso à faixa; saindo para um
       * tamanho fechado ele zera, senão sobraria um 24 escondido descrevendo
       * um colossal que a criatura não é mais.
       */
      const exato = PYRO.tamanhoExatoNaFaixa(ajustado, sys.tamanhoExato ?? this.system.tamanhoExato);
      if (exato !== (sys.tamanhoExato ?? this.system.tamanhoExato)) {
        sys.tamanhoExato = exato;
        changed.system = sys;
      }
    }

    // Recalcula sempre: assim o nome também se corrige quando o mestre muda
    // o padrão da raça nas configurações do mundo.
    if (changed.name === undefined) {
      const projecao = foundry.utils.mergeObject(this.system.toObject(), sys, { inplace: false });
      changed.name = nomeDoCaminho(projecao);
    }
  }

  /**
   * Renomear uma runa regrava o retrato dela nas magias salvas do mesmo
   * ator: a referência guarda o nome para a lista do grimório não depender
   * de resolver o item a cada leitura.
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (this.type !== "runa" || changed.name === undefined) return;
    // Só quem editou dispara a regravação, senão cada cliente repetiria.
    if (game.user.id !== userId || !this.actor) return;
    const updates = [];
    for (const magia of this.actor.items) {
      if (magia.type !== "magia") continue;
      const runas = magia.system.toObject().runas ?? [];
      const minhas = runas.filter(ref => ref.itemId === this.id && ref.nome !== this.name);
      if (!minhas.length) continue;
      for (const ref of minhas) ref.nome = this.name;
      updates.push({ _id: magia.id, "system.runas": runas });
    }
    if (updates.length) this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Dados de rolagem deste item. Sobre o que o ator já oferece, entram os
   * aumentos de atributo dos efeitos presos a este item — eles ficam de fora
   * da ficha justamente para valerem só aqui.
   */
  getRollData() {
    const dados = this.actor?.getRollData() ?? {};
    for (const [chave, delta] of Object.entries(ajustesDeAtributo(this.actor, this))) {
      if (typeof dados[chave] !== "number") continue;
      dados[chave] += delta;
      // A pool acompanha, senão "@dados.for" continuaria na linha antiga.
      if (dados.dados) dados.dados[chave] = formulaPool(dados[chave]);
    }
    return dados;
  }

  /**
   * Rolagens de dano que os efeitos somam a este item, já renderizadas.
   * Cada bônus entra como parcela própria, com tipo, para o desconto de
   * defesa no chat continuar batendo tipo a tipo.
   */
  async #bonusDeDanoHTML(tipoPadrao) {
    const partes = [];
    const danos = [];
    const rolls = [];

    for (const bonus of bonusDeDano(this.actor, this)) {
      const roll = await new Roll(expandirAtributos(bonus.formula), this.getRollData()).evaluate();
      rolls.push(roll);
      // Sem tipo escolhido, o bônus herda o tipo do ataque que ele acompanha.
      const tipo = bonus.tipo || tipoPadrao || "";
      // A fórmula acompanha a parcela: é dela que o Molhado tira o dado a somar.
      danos.push({ tipo, total: roll.total, formula: bonus.formula });
      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      partes.push(
        `<p class="pyro-linha-dano dano-${tipo}">${esc(bonus.nome)}${rotulo ? ` — ${rotulo}` : ""}</p>`,
        await roll.render()
      );
    }
    return { partes, danos, rolls };
  }

  /** Ponto de entrada único de "usar" um item — a ficha chama isso. */
  async usar() {
    // Despertar (regra opcional): comprada mas ainda não recebida.
    if (this.type === "habilidade" && this.system.adormecidaAtiva) {
      return ui.notifications.warn(game.i18n.format("PYRO.Despertar.AdormecidaAviso", { nome: this.name }));
    }
    switch (this.type) {
      case "arma": return this.#atacar();
      case "consumivel": return this.#consumir();
      case "habilidade": return this.system.ehPostura
        ? this.actor?.alternarPostura(this)
        : this.#usarHabilidade();
      case "tecnica": return executarTecnica(this.actor, this);
      case "pericia": return this.actor?.rolarPericia(this);
      case "feitico": return this.#usarFeitico();
      case "magia": return conjurarMagiaSalva(this.actor, this);
      default: return this.#postar();
    }
  }

  /* ---------------------------------------------------------------------- */

  async #atacar() {
    const sys = this.system;
    const actor = this.actor;
    const speaker = ChatMessage.getSpeaker({ actor });

    /* --- Munição: escolhe agora, desconta depois da mira ------------------ */
    let municao = null;
    if (sys.usaMunicao && actor) {
      const opcoes = actor.items.filter(i =>
        i.type === "consumivel" && i.system.municao && i.system.quantidade > 0
      );
      if (!opcoes.length) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemMunicao"));
      }
      const selects = opcoes.map(m =>
        `<option value="${m.id}">${esc(m.name)} (x${m.system.quantidade})</option>`
      ).join("");
      const res = await formularioDoAtor(actor, {
        titulo: game.i18n.localize("PYRO.Municao.Titulo"),
        conteudo: `<div class="form-group">
          <label>${game.i18n.localize("TYPES.Item.consumivel")}</label>
          <select name="municao">${selects}</select>
        </div>`
      });
      if (!res) return;
      municao = actor.items.get(res.municao);
      if (!municao) return;
      // O desconto acontece só depois do teste de mira, pra não gastar
      // munição quando o ataque é cancelado.
    }

    /* --- Teste de mira ------------------------------------------------------ */
    /*
     * O limite é o dobro do alcance do tamanho: um Médio (1m) acerta de graça
     * a 1m e 2m, um Grande (2m) vai até 4m. Duas saídas antes de abrir a
     * janela — arma que nem chega ao limite nunca pede teste (corpo a corpo
     * cai aqui, com alcance máximo 0), e alvo marcado dentro do limite também
     * não. Sem alvo marcado a janela abre e a distância digitada decide.
     */
    const limiteMira = actor?.system.miraLivre ?? 2;
    const rolls = [];
    let mira = null;
    if (sys.alcanceMaximo > limiteMira) {
      const distanciaAlvo = distanciaAteAlvo(actor);
      if (distanciaAlvo === null || distanciaAlvo > limiteMira) {
        mira = await this.#testeDeMira(limiteMira);
        if (mira === null) return; // cancelado: nada é gasto
        rolls.push(mira.roll);
      }
    }

    // Munição some ao disparar, acertando ou errando.
    if (municao) await municao.update({ "system.quantidade": municao.system.quantidade - 1 });

    const alcanceTexto = sys.alcanceMaximo > 0
      ? `${sys.alcanceMenor}/${sys.alcanceMaximo}m` : `${sys.alcanceMenor}m`;
    // Efeito de custo pode baratear ou encarecer o ataque em ações.
    const acoes = custoAjustado(sys.acoes, ajustesDeCusto(actor, this).acoes);
    const detalhes = [
      game.i18n.format("PYRO.Chat.CustoAcoes", { acoes }),
      alcanceTexto
    ].filter(Boolean).join(" · ");
    const partes = [this.#topoHTML(detalhes)];

    if (mira) {
      partes.push(`<div class="pyro-mira ${mira.acertou ? "sucesso" : "falha"}">
        <p>${game.i18n.format("PYRO.Mira.Resultado", { distancia: mira.distancia, nd: mira.nd })}
          — <strong><i class="fa-solid ${mira.acertou ? "fa-check" : "fa-xmark"}"></i>
          ${game.i18n.localize(mira.acertou ? "PYRO.Mira.Acertou" : "PYRO.Mira.Errou")}</strong></p>
        ${await mira.roll.render()}
        ${htmlVontadeGasta(mira.vontade)}
      </div>`);
      if (!mira.acertou) {
        /*
         * Errar não anula o tiro: ele cai em outro lugar, e o que estiver lá
         * vira o novo alvo (SRD §5). Por isso o dano continua sendo rolado
         * abaixo — o card só troca o alvo, e a mesa marca no mapa onde a
         * flecha foi parar.
         */
        rolls.push(mira.desvio.direcao);
        partes.push(`<div class="pyro-desvio">
          <p>${game.i18n.format("PYRO.Mira.Desvio", {
            hora: mira.desvio.hora, metros: mira.desvio.metros
          })}</p>
          ${await mira.desvio.direcao.render()}
          <p class="pyro-nota">${game.i18n.localize("PYRO.Mira.DesvioDica")}</p>
        </div>`);
      }
    }

    // Cada entrada de dano rola separado, com seu próprio tipo — o menu do
    // chat precisa disso pra descontar a defesa certa de cada parcela.
    const danos = [];
    for (const dano of sys.danos ?? []) {
      if (!dano.formula?.trim()) continue;
      const roll = await new Roll(expandirAtributos(dano.formula), this.getRollData()).evaluate();
      rolls.push(roll);
      danos.push({ tipo: dano.tipo, total: roll.total, formula: dano.formula });
      const tipo = game.i18n.localize(PYRO.tiposDano[dano.tipo]?.label ?? dano.tipo ?? "");
      partes.push(`<p class="pyro-linha-dano dano-${dano.tipo}">${tipo}</p>`, await roll.render());
    }

    // Bônus de efeito ("Maestria com Katana: 2d6") entram como parcelas extras.
    const bonus = await this.#bonusDeDanoHTML(sys.danos?.[0]?.tipo);
    partes.push(...bonus.partes);
    danos.push(...bonus.danos);
    rolls.push(...bonus.rolls);

    if (municao) {
      partes.push(`<p class="pyro-nota">${game.i18n.format("PYRO.Municao.Usou", { nome: esc(municao.name) })}</p>`);
      // Munição com fórmula (ex.: Flechas de Raio) rola o dano adicional.
      if (municao.system.formula) {
        const extra = await new Roll(expandirAtributos(municao.system.formula), this.getRollData()).evaluate();
        rolls.push(extra);
        danos.push({ tipo: municao.system.tipoDano, total: extra.total, formula: municao.system.formula });
        const tipoMun = game.i18n.localize(PYRO.tiposDano[municao.system.tipoDano]?.label ?? "");
        partes.push(`<p><strong>${esc(municao.name)}</strong> — ${game.i18n.localize("PYRO.Municao.DanoExtra")}${tipoMun ? ` (${tipoMun})` : ""}</p>`, await extra.render());
      }
    }

    partes.push(htmlEfeitosDeUso(this));

    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">${partes.join("")}</div>`,
      rolls,
      // O menu do chat usa estas flags: dano separado por tipo, sem o teste de
      // mira, e o recurso que o dano mental desta arma drena.
      flags: flagsDoSistema({ danos, cura: 0, recursoMental: sys.recursoMental }),
      sound: CONFIG.sounds.dice
    });
  }

  /**
   * Ajustes que a distância impõe ao tiro (SRD §5): dentro do alcance menor a
   * arma está no ponto e o teste ganha uma vantagem; passando dele, e até o
   * alcance máximo, ganha uma desvantagem. Além do máximo não há tiro, mas o
   * jogador ainda pode digitar a distância — quem decide se a arma alcança é
   * a mesa, e o teste sai com a desvantagem do longe.
   */
  #ajusteDeAlcance(distancia) {
    const sys = this.system;
    /*
     * Arma com alcance menor 0 não tem faixa confortável nenhuma, e aí todo
     * tiro sai com desvantagem. Isso é característica da arma, não um caso
     * esquecido: uma arma de arremesso que deveria ter uma faixa boa precisa
     * do alcance menor preenchido.
     */
    if (sys.alcanceMenor > 0 && distancia <= sys.alcanceMenor) {
      return { vantagem: 1, desvantagem: 0, nota: "PYRO.Mira.NoPonto" };
    }
    return { vantagem: 0, desvantagem: 1, nota: "PYRO.Mira.Longe" };
  }

  /**
   * Janela do teste de mira: DES contra ND igual à distância em metros.
   * Com um alvo marcado, a distância e o ND já vêm preenchidos, e o ajuste do
   * alcance entra sozinho. Errar não perde o tiro: ele vai parar em outro
   * lugar, e o desvio é rolado aqui (SRD §5).
   */
  async #testeDeMira(limiteMira = 2) {
    const sys = this.system;
    const actor = this.actor;
    const medida = distanciaAteAlvo(actor);
    // Sem alvo marcado, começa no primeiro metro que já pede teste.
    const distancia = medida ?? Math.max(limiteMira + 1, sys.alcanceMenor);
    const ajuste = this.#ajusteDeAlcance(distancia);

    const dica = medida !== null
      ? game.i18n.format("PYRO.Mira.AlvoMarcado", { distancia: medida })
      : game.i18n.format("PYRO.Mira.SemAlvoLimite", { limite: limiteMira });

    const res = await formularioDoAtor(actor, {
      titulo: game.i18n.localize("PYRO.Mira.Titulo"),
      // O ND da mira é a distância em metros, então ele já vem preenchido.
      conteudo: camposDeTeste(actor, {
        dica: `${dica} ${game.i18n.localize(ajuste.nota)}`,
        nd: distancia,
        extras: `<div class="form-group"><label>${game.i18n.localize("PYRO.Mira.Distancia")}</label>
          <input type="number" name="distancia" value="${distancia}" min="0"></div>`
      })
    });
    if (!res) return null;

    /*
     * O ajuste é recalculado com a distância que o jogador confirmou, e não
     * com a estimada: quem corrigiu o número para 3m depois de a janela abrir
     * em 12m está atirando de perto, e merece a vantagem do ponto.
     */
    const distanciaFinal = Number(res.distancia) || 0;
    const doAlcance = this.#ajusteDeAlcance(distanciaFinal);
    const opts = { ...res, nd: Number(res.nd) || 0 };
    aplicarExaustaoNoTeste(actor, opts);
    const vontade = await aplicarVontadeNoTeste(actor, res);
    opts.vantagem += doAlcance.vantagem + vontade.beneficio;
    opts.desvantagem += doAlcance.desvantagem;

    const des = actor?.system.atributos.des;
    const formula = des
      ? formulaTeste(valorComInspiracao(des.efetivo, vontade), opts)
      : null;

    // Pool zerada por desvantagens: erra sem rolar (mesma regra dos testes).
    const roll = await new Roll(formula ?? "0").evaluate();
    const nd = opts.nd;
    const acertou = formula !== null && roll.total >= nd;
    return {
      roll, nd, vontade,
      distancia: distanciaFinal,
      acertou,
      desvio: acertou ? null : await this.#desvioDoTiro(roll.total, nd)
    };
  }

  /**
   * Onde o tiro errado foi parar (SRD §5). A direção sai de 1d12 lido como um
   * relógio a partir do ponto além do alvo — 1 é atrás dele, 7 é à frente, na
   * direção de quem atirou —, e a distância é metade do que faltou no teste.
   *
   * Um erro por 1 ponto não move o tiro meio metro: com a diferença abaixo de
   * 2 o desvio é de 1 metro, senão o tiro que quase acertou acertaria mesmo
   * assim, o que não é o que a regra descreve.
   */
  async #desvioDoTiro(total, nd) {
    const direcao = await new Roll("1d12").evaluate();
    const metros = Math.max(1, Math.floor((nd - total) / 2));
    return { direcao, metros, hora: direcao.total };
  }

  async #consumir() {
    const sys = this.system;
    if (sys.quantidade < 1) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemQuantidade"));
    }
    await this.update({ "system.quantidade": sys.quantidade - 1 });

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    if (!sys.formula) return this.#postar();
    const roll = await new Roll(expandirAtributos(sys.formula), this.getRollData()).evaluate();
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(game.i18n.format("PYRO.Chat.CustoAcoes", {
          acoes: custoAjustado(sys.acoes, ajustesDeCusto(this.actor, this).acoes)
        }))}
        ${await roll.render()}
        ${htmlEfeitosDeUso(this)}
      </div>`,
      rolls: [roll],
      // O rodapé do card decide: o valor pode virar cura ou estamina.
      flags: flagsDoSistema({ danos: [], cura: roll.total }),
      sound: CONFIG.sounds.dice
    });
  }

  async #usarHabilidade() {
    const sys = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });

    /*
     * Custos já ajustados pelos efeitos: um "Conjuração Econômica: -2 mana"
     * desconta antes de cobrar, e não só no texto do card. Descontos
     * acumulam, mas o piso é 1 quando havia custo: nada fica de graça.
     */
    const ajustes = ajustesDeCusto(this.actor, this);
    const cobra = {
      estamina: custoAjustado(sys.custoEstamina, ajustes.estamina),
      mana: custoAjustado(sys.custoMana, ajustes.mana),
      energia: custoAjustado(sys.custoEnergia, ajustes.energia)
    };
    const custoAcoes = custoAjustado(sys.custoAcoes, ajustes.acoes);

    const custos = [];
    if (this.actor && (cobra.estamina || cobra.mana || cobra.energia)) {
      const pago = await this.actor.pagarCustos(cobra);
      if (!pago) return; // faltou mana ou energia
      if (pago.daEstamina) custos.push(game.i18n.format("PYRO.Chat.CustoEstamina", { valor: pago.daEstamina }));
      // Sem estamina suficiente, o resto sai dos PV (SRD Recursos).
      if (pago.dosPv) custos.push(game.i18n.format("PYRO.Chat.CustoPv", { valor: pago.dosPv }));
      if (pago.mana) custos.push(game.i18n.format("PYRO.Chat.CustoManaHab", { valor: pago.mana }));
      if (pago.energia) custos.push(game.i18n.format("PYRO.Chat.CustoEnergia", { valor: pago.energia }));
    }

    const chaveCusto = sys.tipoCusto === "reacao" ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes";
    const cab = [
      custoAcoes ? game.i18n.format(chaveCusto, { acoes: custoAcoes }) : null,
      ...custos
    ].filter(Boolean).join(" · ");

    if (sys.formula) {
      const roll = await new Roll(expandirAtributos(sys.formula), this.getRollData()).evaluate();
      return ChatMessage.create({
        speaker,
        content: `<div class="pyro-chat">
          ${this.#topoHTML(cab)}
          ${await roll.render()}
          ${htmlEfeitosDeUso(this)}
        </div>`,
        rolls: [roll],
        // Sem tipo definido: o rodapé oferece dano (sem defesa), cura e estamina.
        flags: flagsDoSistema({ danos: [{ tipo: "", total: roll.total }], cura: roll.total }),
        sound: CONFIG.sounds.dice
      });
    }
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(cab)}
        ${this.system.descricao ?? ""}
        ${htmlEfeitosDeUso(this)}
      </div>`
    });
  }

  async #usarFeitico() {
    const sys = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const cab = sys.custoAcoes
      ? game.i18n.format("PYRO.Chat.CustoAcoes", {
          acoes: custoAjustado(sys.custoAcoes, ajustesDeCusto(this.actor, this).acoes)
        }) : "";

    if (sys.formula) {
      const roll = await new Roll(expandirAtributos(sys.formula), this.getRollData()).evaluate();
      return ChatMessage.create({
        speaker,
        content: `<div class="pyro-chat">
          ${this.#topoHTML(cab)}
          ${await roll.render()}
          ${htmlEfeitosDeUso(this)}
        </div>`,
        rolls: [roll],
        flags: flagsDoSistema({ danos: [{ tipo: "", total: roll.total }], cura: roll.total }),
        sound: CONFIG.sounds.dice
      });
    }
    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">
        ${this.#topoHTML(cab)}
        ${sys.descricao ?? ""}
        ${htmlEfeitosDeUso(this)}
      </div>`
    });
  }

  /** Ajudar um aliado com esta perícia (SRD §5). */
  async ajudar() {
    if (this.type !== "pericia" || !this.actor) return;
    return this.actor.rolarPericia(this, { ajudar: true });
  }

  /** Despertar (regra opcional, SRD §3): a habilidade adormecida floresce. */
  async despertar() {
    if (this.type !== "habilidade" || !this.system.adormecida) return;
    await this.update({ "system.adormecida": false });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pyro-chat">${this.#topoHTML(game.i18n.localize("PYRO.Despertar.Nome"))}
        <p class="pyro-despertou">${game.i18n.format("PYRO.Despertar.Despertou", { nome: esc(this.name) })}</p>
      </div>`
    });
  }

  /** Card de consulta no chat: nome, resumo mecânico e descrição. */
  async mostrarNoChat() {
    const descricao = await enriquecer(this.system.descricao, this);

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pyro-chat pyro-item-card">
        <header class="pyro-item-topo">
          <img src="${this.img}" alt="" />
          <div>
            <h3>${esc(this.name)}</h3>
            <span class="pyro-item-tipo">${game.i18n.localize(`TYPES.Item.${this.type}`)}</span>
          </div>
        </header>
        ${descricao || `<p class="pyro-nota">${game.i18n.localize("PYRO.SemDescricao")}</p>`}
        ${htmlEfeitosDeUso(this)}
      </div>`
    });
  }

  async #postar() {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="pyro-chat">
        ${this.#topoHTML(game.i18n.localize(`TYPES.Item.${this.type}`))}
        ${this.system.descricao || ""}
      </div>`
    });
  }
}
