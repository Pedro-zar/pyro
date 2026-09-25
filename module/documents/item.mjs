/**
 * Documento de item: nomes derivados, consistência de caminho/habilidade/runa
 * nos hooks de criação e edição, e o "usar" de cada tipo (cards do chat).
 */
import { PYRO } from "../config.mjs";
import { conjurarMagiaSalva, scalingsPadrao } from "../magia.mjs";
import { executarTecnica } from "../tecnica.mjs";
import { formulaPool, prepararFormula, comUnidade } from "../dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, multiplicadoresDeDano, aplicarMultDeDano,
  ajustesDeAtributo, ajustesDeCusto, custoAjustado, alcanceDaArma, textoDeAlcance
} from "../efeitos.mjs";
import { esc, enriquecer, formularioDoAtor } from "../ui.mjs";
import { htmlBotaoMira, conferirMira, motivoDaMira } from "../teste.mjs";
import { semForNoDano, regraMental } from "../condicoes.mjs";
import { flagsDoSistema } from "../sistema.mjs";

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
      system: { caminho: this.id, ranque: 1, ehBase: true }
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
    /*
     * Técnica presa a uma postura: o nome acompanha o id escolhido, e é ele
     * que segura a regra quando a técnica é copiada para outro personagem,
     * onde o id da postura é outro. Escolher "nenhuma" limpa os dois.
     *
     * Id que não resolve numa postura desta ficha mantém o nome guardado, em
     * vez de apagá-lo: é o caso da técnica que veio de outro personagem, e é
     * justamente o nome que faz a regra continuar valendo lá.
     */
    if (this.type === "tecnica" && sys.postura?.id !== undefined) {
      const id = sys.postura.id;
      const item = id ? this.actor?.items?.get(id) : null;
      const daFicha = item?.type === "habilidade" && item.system?.ehPostura ? item : null;
      sys.postura = {
        id,
        nome: !id ? "" : (daFicha?.name ?? sys.postura.nome ?? this.system.postura.nome ?? "")
      };
      changed.system = sys;
    }

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
    /*
     * [NVL]: o nível deste item. Técnica, perícia e magia guardam o nível em
     * progresso (ele sobe pelo uso); a habilidade tem o dela em system.nivel,
     * editado à mão. Item sem nenhum dos dois (uma arma) vale 0.
     */
    dados.nvl = Number(this.system?.progresso?.nivel ?? this.system?.nivel) || 0;
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
      const dados = semForNoDano(this.actor, this.getRollData());
      const roll = await new Roll(prepararFormula(bonus.formula, dados), dados).evaluate();
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
      case "habilidade":
        if (this.system.ehPostura) return this.actor?.alternarPostura(this);
        if (this.system.ehTransformacao) return this.actor?.alternarTransformacao(this);
        return this.#usarHabilidade();
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
    if (actor && !actor.podeAgir()) return;
    const speaker = ChatMessage.getSpeaker({ actor });

    /* --- Munição: escolhe antes de qualquer gasto ------------------------- */
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
    }

    /* --- Mira: o card pede o teste, e o jogador escolhe quando rolar -------- */
    /*
     * A distância é medida agora, e não no clique do botão: o tiro saiu daqui,
     * e o token pode andar antes de alguém conferir a pontaria. O resto da
     * regra é a mesma de toda forma de atacar, e mora em conferirMira.
     */
    const alcance = alcanceDaArma(actor, this);
    const mira = conferirMira(actor, alcance.maximo || alcance.menor);
    const rolls = [];

    // Munição some ao disparar, acertando ou errando.
    if (municao) await municao.update({ "system.quantidade": municao.system.quantidade - 1 });

    // Efeito de custo pode baratear ou encarecer o ataque em ações.
    const acoes = custoAjustado(sys.acoes, ajustesDeCusto(actor, this).acoes);
    const detalhes = [
      game.i18n.format("PYRO.Chat.CustoAcoes", { acoes }),
      textoDeAlcance(alcance)
    ].filter(Boolean).join(" · ");
    const partes = [this.#topoHTML(detalhes)];

    /*
     * De onde veio o alcance, quando ele não é o da ficha da arma: um "2m"
     * numa arma de 1m parece defeito sem isso.
     */
    if (alcance.mudou) {
      partes.push(`<p class="pyro-nota">${game.i18n.format("PYRO.Efeitos.AlcanceAplicado", {
        nomes: esc(alcance.nomes.join(", ")),
        antes: textoDeAlcance(alcance.base),
        depois: textoDeAlcance(alcance)
      })}</p>`);
    }

    if (mira.pede) {
      partes.push(htmlBotaoMira({
        atorUuid: actor.uuid,
        itemUuid: this.uuid,
        distancia: mira.distancia ?? "",
        limite: mira.limite,
        alcance: alcance.menor,
        motivo: motivoDaMira(mira)
      }));
    }

    // Cada entrada de dano rola separado, com seu próprio tipo — o menu do
    // chat precisa disso pra descontar a defesa certa de cada parcela.
    const danos = [];
    for (const dano of sys.danos ?? []) {
      if (!dano.formula?.trim()) continue;
      const dados = semForNoDano(actor, this.getRollData());
      const roll = await new Roll(prepararFormula(dano.formula, dados), dados).evaluate();
      rolls.push(roll);
      danos.push({ tipo: dano.tipo, total: roll.total, formula: dano.formula });
      const tipo = game.i18n.localize(PYRO.tiposDano[dano.tipo]?.label ?? dano.tipo ?? "");
      partes.push(`<p class="pyro-linha-dano dano-${dano.tipo}">${tipo}</p>`, await roll.render());
    }

    /*
     * O abatido zera a Força no dano, e o card diz isso: um "2d8 + 0" sem
     * explicação parece defeito, e não a condição fazendo efeito.
     */
    if (danos.length && regraMental(actor, "semForNoDano")) {
      partes.push(`<p class="pyro-nota">${game.i18n.localize("PYRO.Mental.SemForNoDano")}</p>`);
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
        const dadosMun = semForNoDano(actor, this.getRollData());
        const extra = await new Roll(prepararFormula(municao.system.formula, dadosMun), dadosMun).evaluate();
        rolls.push(extra);
        danos.push({ tipo: municao.system.tipoDano, total: extra.total, formula: municao.system.formula });
        const tipoMun = game.i18n.localize(PYRO.tiposDano[municao.system.tipoDano]?.label ?? "");
        partes.push(`<p><strong>${esc(municao.name)}</strong> — ${game.i18n.localize("PYRO.Municao.DanoExtra")}${tipoMun ? ` (${tipoMun})` : ""}</p>`, await extra.render());
      }
    }

    // Multiplicadores de dano dos efeitos (Pugilista ×1,25 por nível) mexem
    // no total que os botões de aplicar usam; a nota explica o número novo.
    for (const nota of aplicarMultDeDano(danos, multiplicadoresDeDano(actor, this))) {
      partes.push(`<p class="pyro-nota">${nota}</p>`);
    }

    partes.push(htmlEfeitosDeUso(this));

    return ChatMessage.create({
      speaker,
      content: `<div class="pyro-chat">${partes.join("")}</div>`,
      rolls,
      // O menu do chat usa estas flags: dano separado por tipo e o recurso
      // que o dano mental desta arma drena.
      flags: flagsDoSistema({ danos, cura: 0, recursoMental: sys.recursoMental }),
      // Arma sem fórmula de dano nenhuma não rola nada, e o som de dado num
      // card sem dado é ruído.
      ...(rolls.length ? { sound: CONFIG.sounds.dice } : {})
    });
  }


  async #consumir() {
    if (this.actor && !this.actor.podeAgir()) return;
    const sys = this.system;
    if (sys.quantidade < 1) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemQuantidade"));
    }
    await this.update({ "system.quantidade": sys.quantidade - 1 });

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    if (!sys.formula) return this.#postar();
    const dados = this.getRollData();
    const roll = await new Roll(prepararFormula(sys.formula, dados), dados).evaluate();
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

  /**
   * Cobra um uso desta habilidade — recursos e ações, já com os descontos dos
   * efeitos — e devolve a linha que o card mostra no cabeçalho.
   *
   * Fica público porque entrar numa transformação é um uso como outro
   * qualquer, e quem conduz a entrada é o ator (ver alternarTransformacao):
   * sem isto a forma teria uma segunda cópia da mesma cobrança, que ia
   * divergir da primeira no dia em que uma das duas mudasse.
   *
   * @returns {Promise<string|null>} a linha de custos (vazia quando nada foi
   *   cobrado), ou null quando faltou recurso e nada foi gasto.
   */
  async cobrarUso() {
    const sys = this.system;
    if (this.actor && !this.actor.podeAgir()) return null;

    /*
     * Custos já ajustados pelos efeitos: um "Conjuração Econômica: -2 mana"
     * desconta antes de cobrar, e não só no texto do card. Descontos
     * acumulam, mas o piso é 1 quando havia custo: nada fica de graça.
     */
    const ajustes = ajustesDeCusto(this.actor, this);
    const cobra = {
      estamina: custoAjustado(sys.custoEstamina, ajustes.estamina),
      mana: custoAjustado(sys.custoMana, ajustes.mana),
      energia: custoAjustado(sys.custoEnergia, ajustes.energia),
      vontade: custoAjustado(sys.custoVontade, ajustes.vontade)
    };
    // Recursos de raça (energia natural etc.): os efeitos de desconto usam a
    // mesma chave do recurso, então o ajuste entra igual ao dos fixos.
    for (const [chave, valor] of Object.entries(sys.custosCustom ?? {})) {
      if (PYRO.recursosCustom?.[chave] && Number(valor) > 0) {
        cobra[chave] = custoAjustado(Number(valor), ajustes[chave]);
      }
    }
    const custoAcoes = custoAjustado(sys.custoAcoes, ajustes.acoes);

    const custos = [];
    if (this.actor && Object.values(cobra).some(v => v > 0)) {
      const pago = await this.actor.pagarCustos(cobra);
      if (!pago) return null; // faltou algum recurso
      if (pago.daEstamina) custos.push(game.i18n.format("PYRO.Chat.CustoEstamina", { valor: pago.daEstamina }));
      // Sem estamina suficiente, o resto sai dos PV (SRD Recursos).
      if (pago.dosPv) custos.push(game.i18n.format("PYRO.Chat.CustoPv", { valor: pago.dosPv }));
      if (pago.mana) custos.push(game.i18n.format("PYRO.Chat.CustoManaHab", { valor: pago.mana }));
      if (pago.energia) custos.push(game.i18n.format("PYRO.Chat.CustoEnergia", { valor: pago.energia }));
      if (pago.vontade) custos.push(game.i18n.format("PYRO.Chat.CustoVontade", { valor: pago.vontade }));
      for (const chave of Object.keys(PYRO.recursosCustom ?? {})) {
        if (!pago[chave]) continue;
        custos.push(game.i18n.format("PYRO.Chat.CustoRecurso", {
          valor: pago[chave],
          recurso: game.i18n.localize(PYRO.recursosCustom[chave].label)
        }));
      }
    }

    const chaveCusto = sys.tipoCusto === "reacao" ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes";
    return [
      custoAcoes ? game.i18n.format(chaveCusto, { acoes: custoAcoes }) : null,
      ...custos
    ].filter(Boolean).join(" · ");
  }

  async #usarHabilidade() {
    const cab = await this.cobrarUso();
    if (cab === null) return;
    return this.cardDeHabilidade(cab);
  }

  /**
   * Card de habilidade: o resultado da fórmula em uma linha de texto e a
   * descrição embaixo.
   *
   * Usar, mostrar no chat e entrar numa postura produzem o mesmo card de
   * propósito — o que muda entre eles é o que acontece antes (o custo cobrado,
   * a postura que passa a valer), não o que a mesa lê depois. Fica sem os
   * botões de aplicar dano ou cura: a habilidade diz "1 minuto antes de ser
   * percebido", e isso não é dano de ninguém.
   * @param {string} meta linha de contexto no cabeçalho do card.
   * @param {string[]} [sussurro] ids de quem recebe; vazio publica na mesa.
   */
  async cardDeHabilidade(meta, sussurro = []) {
    const sys = this.system;
    const partes = [this.#topoHTML(meta)];
    const rolls = [];

    if (sys.formula) {
      const dados = this.getRollData();
    const roll = await new Roll(prepararFormula(sys.formula, dados), dados).evaluate();
      rolls.push(roll);
      // A fórmula não aparece: o que interessa é o número com o que ele é
      // ("1 minuto antes de ser percebido"). Ela fica na dica, para quem
      // quiser conferir de onde saiu.
      partes.push(`<p class="pyro-total-unidade" title="${esc(`${roll.formula} = ${roll.total}`)}">
        ${esc(comUnidade(roll.total, sys.unidadeFormula))}</p>`);
    }

    const descricao = await enriquecer(sys.descricao, this);
    partes.push(descricao || `<p class="pyro-nota">${game.i18n.localize("PYRO.SemDescricao")}</p>`);
    partes.push(htmlEfeitosDeUso(this));

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      whisper: sussurro,
      content: `<div class="pyro-chat pyro-item-card">${partes.join("")}</div>`,
      rolls,
      sound: rolls.length ? CONFIG.sounds.dice : undefined
    });
  }

  async #usarFeitico() {
    if (this.actor && !this.actor.podeAgir()) return;
    const sys = this.system;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const cab = sys.custoAcoes
      ? game.i18n.format("PYRO.Chat.CustoAcoes", {
          acoes: custoAjustado(sys.custoAcoes, ajustesDeCusto(this.actor, this).acoes)
        }) : "";

    if (sys.formula) {
      const dados = this.getRollData();
    const roll = await new Roll(prepararFormula(sys.formula, dados), dados).evaluate();
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
    // Habilidade tem card próprio, e mostrar é o mesmo que usar sem cobrar.
    if (this.type === "habilidade") {
      return this.cardDeHabilidade(game.i18n.localize("TYPES.Item.habilidade"));
    }
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
