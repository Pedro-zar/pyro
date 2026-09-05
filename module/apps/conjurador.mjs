import { PYRO } from "../config.mjs";
import { calcular, conjurar, previaRuna } from "../magia.mjs";
import { pintarTema } from "../tema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Montagem de frases rúnicas. A frase é uma sequência de fichas, cada uma com
 * sua Intenção, e os medidores de mana e sobrecarga respondem a cada mudança —
 * a ideia é que o custo e o risco apareçam antes de conjurar, não depois.
 */
export class ConjuradorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, frase = [], nomeMagia = "", fixa = false, itemMagia = null, ...options } = {}) {
    super(options);
    this.actor = actor;
    /** Runas escolhidas, na ordem da frase: [{ id, intencao, scalings? }] */
    this.frase = frase;
    this.nomeMagia = nomeMagia;
    /** Magia salva: a frase é fixa, só as Intenções mudam. */
    this.fixa = fixa;
    /** Item de magia de origem, quando veio do grimório (leva os efeitos de uso). */
    this.itemMagia = itemMagia;
  }

  /** Conjurando uma magia salva, o título é o nome dela. */
  get title() {
    return this.fixa && this.nomeMagia
      ? game.i18n.format("PYRO.Conjurador.TituloMagia", { nome: this.nomeMagia })
      : super.title;
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-conjurador-{id}",
    classes: ["pyro", "conjurador"],
    tag: "form",
    position: { width: 640, height: "auto" },
    window: { title: "PYRO.Conjurador.Titulo", resizable: true },
    form: { handler: ConjuradorApp.#aoConjurar, closeOnSubmit: false },
    actions: {
      adicionarRuna: ConjuradorApp.#adicionarRuna,
      removerRuna: ConjuradorApp.#removerRuna,
      subirIntencao: ConjuradorApp.#subirIntencao,
      descerIntencao: ConjuradorApp.#descerIntencao,
      limparFrase: ConjuradorApp.#limparFrase
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/conjurador.hbs" }
  };

  /* ---------------------------------------------------------------------- */

  /** Limite seguro de Intenção desta runa: escala quando a raça supera a língua. */
  #limiteDaRuna(item) {
    const fatorRaca = this.actor.system.fatorLinguistico ?? 1;
    const lingua = PYRO.linguas[item.system.lingua];
    return Math.floor(this.actor.system.sobrecargaLimite * Math.max(1, fatorRaca / lingua.fator));
  }

  #escolhas() {
    // scalings vem preenchido quando a frase nasce de uma magia salva: são a
    // cópia editada na magia, que sobrepõe os da runa na conjuração.
    return this.frase
      .map(f => ({
        item: this.actor.items.get(f.id), intencao: f.intencao,
        scalings: f.scalings, subjulgar: f.subjulgar, tipoDano: f.tipoDano
      }))
      .filter(e => e.item);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const nativa = actor.system.linguaNativa;
    const mana = actor.system.recursos.mana;
    const loc = k => game.i18n.localize(k);

    const escolhas = this.#escolhas();
    // Passa a magia salva: efeitos de custo presos a ela contam já na prévia.
    const calc = calcular(actor, escolhas, this.itemMagia);

    /* --- Fichas da frase montada ----------------------------------------- */
    const fichas = calc.porRuna.map((pr, indice) => {
      const s = pr.item.system;
      return {
        indice,
        // Em magia salva, só o que foi adicionado agora pode ser tirado.
        removivel: !this.fixa || !this.frase[indice]?.original,
        nome: s.palavra || pr.item.name,
        tipo: loc(PYRO.tiposRuna[s.tipoRuna] ?? ""),
        cor: s.tipoRuna === "elemento" && PYRO.elementos[s.subtipo] ? s.subtipo : null,
        intencao: pr.intencao,
        custo: pr.custo,
        limite: pr.limite,
        excesso: pr.excesso,
        limiteTexto: game.i18n.format("PYRO.Conjurador.LimiteRuna", { n: pr.limite }),
        // O que esta runa produz na Intenção escolhida (cópia da magia, se houver).
        previa: previaRuna(pr.item, pr.intencao, pr.efeitoMult, pr.scalings, pr.tipoDano),
        lingua: s.lingua !== nativa ? loc(PYRO.linguas[s.lingua]?.label ?? "") : null
      };
    });

    /* --- Runas disponíveis, por grupo ------------------------------------ */
    const naFrase = new Set(this.frase.map(f => f.id));
    const maosDisponiveis = actor.system.maos ?? 2;
    const grupo = tipo => actor.items
      .filter(i => i.type === "runa" && i.system.tipoRuna === tipo)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(r => ({
        id: r.id,
        nome: r.system.palavra || r.name,
        cor: tipo === "elemento" && PYRO.elementos[r.system.subtipo] ? r.system.subtipo : null,
        lingua: r.system.lingua !== nativa
          ? loc(PYRO.linguas[r.system.lingua]?.label ?? "") : null,
        // Cada runa entra uma vez só na frase.
        usada: naFrase.has(r.id),
        // Gesto sem mão livre não entra: o botão explica o porquê.
        bloqueada: tipo !== "elemento" && !naFrase.has(r.id)
          && calc.maos + (r.system.maos ?? 1) > maosDisponiveis,
        limite: this.#limiteDaRuna(r),
        limiteTexto: game.i18n.format("PYRO.Conjurador.LimiteRuna", { n: this.#limiteDaRuna(r) })
      }));

    /* --- Medidores -------------------------------------------------------- */
    const faltaMana = calc.custoTotal > mana.value;
    const excedeMaos = calc.maos > maosDisponiveis;
    const podeConjurar = escolhas.length > 0 && calc.temElemento && calc.temForma
      && !faltaMana && !excedeMaos;
    // Guardar no grimório não gasta mana nem mãos: só a frase precisa valer.
    this._podeConjurar = podeConjurar;
    this._podeGuardar = escolhas.length > 0 && calc.temElemento && calc.temForma;

    Object.assign(context, {
      actor,
      fichas,
      temFrase: fichas.length > 0,
      elementos: grupo("elemento"),
      formas: grupo("forma"),
      modificadores: grupo("modificador"),
      semRunas: !actor.items.some(i => i.type === "runa"),

      custoTotal: calc.custoTotal,
      manaAtual: mana.value,
      manaMax: mana.max,
      manaRestante: mana.value - calc.custoTotal,
      // Barra de mana: parte já gasta e parte que esta magia vai consumir.
      pctUsada: mana.max > 0 ? Math.clamp((mana.value / mana.max) * 100, 0, 100) : 0,
      pctCusto: mana.max > 0 ? Math.clamp((calc.custoTotal / mana.max) * 100, 0, 100) : 0,
      faltaMana,

      acoes: calc.acoes,
      acoesTexto: game.i18n.format("PYRO.Conjurador.Acoes", { n: calc.acoes }),
      restanteTexto: game.i18n.format("PYRO.Conjurador.Restante", { n: mana.value - calc.custoTotal }),
      sobrecarga: calc.sobrecarga,
      sobrecargaTexto: calc.sobrecarga > 0
        ? game.i18n.format("PYRO.Conjurador.SobrecargaN", { nivel: calc.sobrecarga, nd: calc.nd })
        : "",
      nd: calc.nd,
      limiteBase: actor.system.sobrecargaLimite,

      faltaElemento: escolhas.length > 0 && !calc.temElemento,
      faltaForma: escolhas.length > 0 && !calc.temForma,
      excedeMaos,
      maosTexto: calc.maos > 0
        ? game.i18n.format("PYRO.Conjurador.Maos", { usadas: calc.maos, total: maosDisponiveis })
        : "",
      podeConjurar,
      fixa: this.fixa,
      nomeMagia: this.nomeMagia
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */
  /*  Montagem da frase                                                     */
  /* ---------------------------------------------------------------------- */

  /** Guarda nome e checkbox de salvar antes de re-renderizar. */
  #capturarCampos() {
    const form = this.element;
    if (!form) return;
    this.nomeMagia = form.querySelector("[name=nomeMagia]")?.value ?? this.nomeMagia;
    this.salvar = form.querySelector("[name=salvar]")?.checked ?? this.salvar;
    this.rolarDano = form.querySelector("[name=rolarDano]")?.checked ?? this.rolarDano;
  }

  static #adicionarRuna(event, target) {
    this.#capturarCampos();
    const id = target.dataset.runaId;
    // Uma runa por frase: repetir a palavra não soma efeito, aumenta a Intenção.
    if (this.frase.some(f => f.id === id)) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Conjurador.RunaRepetida"));
    }
    // Gesto sem mão livre não entra na frase.
    const runa = this.actor.items.get(id);
    if (runa && runa.system.tipoRuna !== "elemento") {
      const calc = calcular(this.actor, this.#escolhas(), this.itemMagia);
      if (calc.maos + (runa.system.maos ?? 1) > (this.actor.system.maos ?? 2)) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Conjurador.SemMaosLivres"));
      }
    }
    this.frase.push({ id, intencao: 1 });
    this.render();
  }

  static #removerRuna(event, target) {
    this.#capturarCampos();
    this.frase.splice(Number(target.dataset.indice), 1);
    this.render();
  }

  static #subirIntencao(event, target) {
    this.#capturarCampos();
    const f = this.frase[Number(target.dataset.indice)];
    if (f) f.intencao += 1;
    this.render();
  }

  static #descerIntencao(event, target) {
    this.#capturarCampos();
    const f = this.frase[Number(target.dataset.indice)];
    if (f && f.intencao > 1) f.intencao -= 1;
    this.render();
  }

  static #limparFrase() {
    this.#capturarCampos();
    this.frase = [];
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor ?? null);
    // Restaura o que o jogador já tinha digitado antes da re-renderização.
    const form = this.element;
    const nome = form.querySelector("[name=nomeMagia]");
    if (nome && this.nomeMagia) nome.value = this.nomeMagia;
    const salvar = form.querySelector("[name=salvar]");
    if (salvar && this.salvar !== undefined) salvar.checked = this.salvar;
    const dano = form.querySelector("[name=rolarDano]");
    if (dano && this.rolarDano !== undefined) dano.checked = this.rolarDano;

    // "Salvar no grimório" transforma o botão: Guardar, com nome obrigatório.
    const botao = form.querySelector("button[type=submit]");
    const atualizarModo = () => {
      const guardando = !this.fixa && !!form.querySelector("[name=salvar]")?.checked;
      if (botao) {
        botao.innerHTML = guardando
          ? `<i class="fa-solid fa-book"></i> ${game.i18n.localize("PYRO.Conjurador.Guardar")}`
          : `<i class="fa-solid fa-wand-sparkles"></i> ${game.i18n.localize("PYRO.Conjurador.Conjurar")}`;
        botao.disabled = guardando ? !this._podeGuardar : !this._podeConjurar;
      }
      const campoNome = form.querySelector("[name=nomeMagia]");
      if (campoNome) {
        campoNome.placeholder = game.i18n.localize(guardando
          ? "PYRO.Conjurador.NomeObrigatorioPlaceholder"
          : "PYRO.Conjurador.NomePlaceholder");
      }
    };
    salvar?.addEventListener("change", atualizarModo);
    atualizarModo();
  }

  /* ---------------------------------------------------------------------- */

  static async #aoConjurar(event, form, formData) {
    const escolhas = this.#escolhas();
    if (!escolhas.length) return;

    const dados = formData.object;
    // Magia salva: sem re-salvar e o dano rola sempre.
    if (this.fixa) {
      await conjurar(this.actor, escolhas, {
        nomeMagia: this.nomeMagia, rolarDano: true, itemMagia: this.itemMagia
      });
      return this.close();
    }

    /*
     * Guardar no grimório: só registra a frase, sem conjurar nem gastar
     * mana. O nome é obrigatório — sem ele a janela continua aberta.
     * As Intenções são escolhidas a cada conjuração; escalonamentos, tipo
     * de dano e Subjulgar entram como cópia editável na magia.
     */
    if (dados.salvar) {
      const nome = dados.nomeMagia?.trim();
      if (!nome) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Conjurador.NomeObrigatorio"));
      }
      await Item.implementation.create({
        name: nome,
        type: "magia",
        system: {
          runas: escolhas.map(e => ({
            itemId: e.item.id,
            nome: e.item.name,
            subjulgar: e.subjulgar ?? e.item.system.subjulgar ?? false,
            tipoDano: e.tipoDano ?? e.item.system.tipoDano ?? "",
            scalings: foundry.utils.deepClone(e.scalings ?? e.item.system.scalings ?? [])
          }))
        }
      }, { parent: this.actor });
      ui.notifications.info(game.i18n.format("PYRO.Conjurador.Salva", { nome }));
      return this.close();
    }

    await conjurar(this.actor, escolhas, {
      nomeMagia: dados.nomeMagia?.trim() || null,
      rolarDano: !!dados.rolarDano
    });
    return this.close();
  }
}
