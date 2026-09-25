import { PYRO } from "../config.mjs";
import {
  calcular, conjurar, previaRuna, emprestaIntencao, temDanoMental, resumoDaFrase, fatorPtBR
} from "../magia.mjs";
import { bonusDeDano, operacoesDeAlcance } from "../efeitos.mjs";
import { juntarDados } from "../dados.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho } from "../sistema.mjs";

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
    /** Recurso que o dano mental desta conjuração drena (SRD §6). */
    this.recursoMental = "mana";
    /*
     * A magia impõe resistência? Magia salva traz a resposta gravada nela;
     * frase montada na hora pergunta, e a resposta acompanha a magia se ela
     * for guardada no grimório.
     */
    this.usaDt = itemMagia ? itemMagia.system.usaDt !== false : true;
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
    position: { width: 900, height: "auto" },
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
    form: { template: caminho("templates/apps/conjurador.hbs") }
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
        scalings: f.scalings, subjulgar: f.subjulgar, tipoDano: f.tipoDano,
        alvoToque: f.alvoToque
      }))
      .filter(e => e.item);
  }

  /**
   * A coluna da direita: o que a frase vai produzir, com dados de mesmo tipo
   * numa fórmula só e escalonamentos de mesmo nome numa linha só.
   *
   * É o mesmo resumo que o card do chat publica. Duas runas que deviam somar
   * e aparecem em duas linhas aqui vão aparecer em duas linhas lá também —
   * ver isso antes de gastar mana é metade do motivo desta coluna existir.
   */
  #previa(calc) {
    const loc = k => game.i18n.localize(k);
    const vazia = {
      titulo: loc("PYRO.Previa.Magia"), dano: [], linhas: [],
      temAlgo: false, vazio: loc("PYRO.Previa.VaziaMagia")
    };
    // Frase vazia não tem prévia: a DT sozinha não é uma magia.
    if (!calc.porRuna.length) return vazia;
    // O bônus de dano de um efeito entra na fórmula do card; entra aqui também,
    // ou a coluna anuncia menos dado do que a rolagem vai ter.
    const rolando = this.fixa || this.rolarDano !== false;
    const resumo = resumoDaFrase(calc, {
      bonusDano: rolando ? bonusDeDano(this.actor, this.itemMagia) : [],
      opsAlcance: operacoesDeAlcance(this.actor, this.itemMagia)
    });
    const linhas = resumo.numeros.map(n => ({
      nome: n.nome,
      texto: n.porPassos
        ? game.i18n.format("PYRO.Previa.AlcancePorPassos", { valor: n.valor, passos: n.porPassos })
        : String(n.valor),
      origens: n.origens.join(", ")
    }));

    // Intenção que vira botão de regra no card (Molhado, Friagem, Defesa
    // Física, Condições Mentais): é efeito da magia como qualquer outro.
    for (const regra of resumo.regras) {
      linhas.push({ nome: regra.nome, texto: String(regra.valor), origens: regra.origem });
    }

    if (this.usaDt) {
      linhas.push({ nome: loc("PYRO.Previa.Dt"), texto: String(calc.dt), origens: "" });
    }
    if (calc.bonusMira) {
      linhas.push({ nome: loc("PYRO.Previa.Mira"), texto: `+${calc.bonusMira}`, origens: "" });
    }
    if (calc.alvosDivididos > 1) {
      linhas.push({
        nome: loc("PYRO.Previa.Dividido"),
        texto: String(calc.alvosDivididos),
        origens: ""
      });
    }

    // Subjulgar não soma no dano: a rolagem dele é comparada com a vida do
    // alvo, então fica numa linha própria, como no card.
    /*
     * O dano do mesmo tipo sai numa linha só ("Calor 2d6 + 3d4 — Abrasar,
     * Sopro"), mesmo quando os multiplicadores diferem — aí cada fator vira
     * a própria linha de "Multiplicador de dano", com a origem dele. Menos
     * linhas, e fica claro qual runa multiplica quanto; a rolagem em si
     * continua separada por fator, mas isso é assunto do card.
     */
    const dano = [];
    const porTipo = new Map();
    for (const d of resumo.danos) {
      const g = porTipo.get(d.rotulo) ?? { formulas: [], origens: new Set(), mults: [] };
      g.formulas.push(d.formula);
      for (const o of d.origens) g.origens.add(o);
      if ((d.fator ?? 1) !== 1) g.mults.push({ fator: d.fator, origens: d.origens.join(", ") });
      porTipo.set(d.rotulo, g);
    }
    for (const [rotulo, g] of porTipo) {
      dano.push({ rotulo, texto: juntarDados(g.formulas), origens: [...g.origens].join(", ") });
      for (const m of g.mults) {
        dano.push({ rotulo: loc("PYRO.Previa.MultDano"), texto: `x${fatorPtBR(m.fator)}`, origens: m.origens });
      }
    }
    for (const sub of resumo.subjulgares) {
      dano.push({ rotulo: loc("PYRO.Previa.Subjulgar"), texto: sub.formula, origens: sub.nomeRuna });
      if ((sub.fator ?? 1) !== 1) {
        dano.push({ rotulo: loc("PYRO.Previa.MultDano"), texto: `x${fatorPtBR(sub.fator)}`, origens: sub.nomeRuna });
      }
    }

    return {
      titulo: loc("PYRO.Previa.Magia"),
      dano,
      linhas,
      temAlgo: dano.length > 0 || linhas.length > 0,
      vazio: loc("PYRO.Previa.VaziaMagia")
    };
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
      const sys = pr.item.system;
      const ehToque = emprestaIntencao(pr.item);
      return {
        indice,
        // Em magia salva, só o que foi adicionado agora pode ser tirado.
        removivel: !this.fixa || !this.frase[indice]?.original,
        nome: sys.palavra || pr.item.name,
        tipo: loc(PYRO.tiposRuna[sys.tipoRuna] ?? ""),
        cor: sys.tipoRuna === "elemento" && PYRO.elementos[sys.subtipo] ? sys.subtipo : null,
        intencao: pr.intencao,
        // O Toque empresta Intenção: a runa reforçada produz como se tivesse mais.
        emprestada: pr.intencaoEfetiva - pr.intencao,
        custo: pr.custo,
        limite: pr.limite,
        excesso: pr.excesso,
        limiteTexto: game.i18n.format("PYRO.Conjurador.LimiteRuna", { n: pr.limite }),
        // O que esta runa produz na Intenção escolhida (cópia da magia, se houver).
        previa: previaRuna(pr, calc.passosAlcance),
        lingua: sys.lingua !== nativa ? loc(PYRO.linguas[sys.lingua]?.label ?? "") : null,
        // Toque escolhe quem recebe a Intenção emprestada.
        ehToque,
        alvosToque: !ehToque ? null : calc.porRuna
          .filter(outra => outra !== pr)
          .map(outra => ({
            id: outra.item.id,
            nome: outra.item.system.palavra || outra.item.name,
            ativo: outra.item.id === pr.alvoToque
          }))
      };
    });

    /* --- Runas disponíveis, por grupo ------------------------------------ */
    const naFrase = new Set(this.frase.map(f => f.id));
    const maosDisponiveis = actor.system.maos ?? 2;
    const grupo = tipo => actor.items
      .filter(i => i.type === "runa" && i.system.tipoRuna === tipo)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map(runa => ({
        id: runa.id,
        nome: runa.system.palavra || runa.name,
        cor: tipo === "elemento" && PYRO.elementos[runa.system.subtipo] ? runa.system.subtipo : null,
        lingua: runa.system.lingua !== nativa
          ? loc(PYRO.linguas[runa.system.lingua]?.label ?? "") : null,
        // Cada runa entra uma vez só na frase.
        usada: naFrase.has(runa.id),
        // Gesto sem mão livre não entra: o botão explica o porquê.
        bloqueada: tipo !== "elemento" && !naFrase.has(runa.id)
          && calc.maos + (runa.system.maos ?? 1) > maosDisponiveis,
        limite: this.#limiteDaRuna(runa),
        limiteTexto: game.i18n.format("PYRO.Conjurador.LimiteRuna", { n: this.#limiteDaRuna(runa) })
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
      previa: this.#previa(calc),
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
      // Sem DT nesta conjuração, o medidor não anuncia uma que não existe.
      dtTexto: this.usaDt ? game.i18n.format("PYRO.Magia.DT", { valor: calc.dt }) : "",
      limiteBase: actor.system.sobrecargaLimite,

      faltaElemento: escolhas.length > 0 && !calc.temElemento,
      faltaForma: escolhas.length > 0 && !calc.temForma,
      excedeMaos,
      maosTexto: calc.maos > 0
        ? game.i18n.format("PYRO.Conjurador.Maos", { usadas: calc.maos, total: maosDisponiveis })
        : "",
      podeConjurar,
      /*
       * Dano mental não tira Vida: escolher de qual recurso ele sai é parte
       * da conjuração, e não da hora de aplicar no chat. O select só aparece
       * quando a frase tem de fato um elemento mental.
       */
      pedeRecursoMental: temDanoMental(calc.porRuna),
      // Magia salva já respondeu isso na criação: a caixa fica na ficha dela.
      perguntaDt: !this.fixa,
      usaDt: this.usaDt,
      recursosMentais: Object.fromEntries(Object.entries(PYRO.recursosDrenaveis())
        .map(([k, label]) => [k, loc(label)])),
      recursoMental: this.recursoMental,
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
    // Quem o Toque reforça é escolha da conjuração, não da runa.
    for (const select of form.querySelectorAll("[name^='alvoToque.']")) {
      const indice = Number(select.name.split(".")[1]);
      if (this.frase[indice]) this.frase[indice].alvoToque = select.value;
    }
    this.recursoMental = form.querySelector("[name=recursoMental]")?.value ?? this.recursoMental;
    this.usaDt = form.querySelector("[name=usaDt]")?.checked ?? this.usaDt;
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

    /*
     * Trocar quem o Toque reforça muda a Intenção efetiva da runa escolhida,
     * e a prévia dela vive na ficha ao lado. Sem este ouvinte o "+X" só se
     * mexia no próximo clique de Intenção, mostrando a conta antiga.
     */
    for (const select of form.querySelectorAll("[name^='alvoToque.']")) {
      select.addEventListener("change", () => {
        this.#capturarCampos();
        this.render();
      });
    }
  }

  /* ---------------------------------------------------------------------- */

  static async #aoConjurar(event, form, formData) {
    this.#capturarCampos();
    const escolhas = this.#escolhas();
    if (!escolhas.length) return;

    const dados = formData.object;
    // Magia salva: sem re-salvar e o dano rola sempre.
    if (this.fixa) {
      await conjurar(this.actor, escolhas, {
        nomeMagia: this.nomeMagia, rolarDano: true, itemMagia: this.itemMagia,
        recursoMental: this.recursoMental, usaDt: this.usaDt
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
          usaDt: this.usaDt,
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
      rolarDano: !!dados.rolarDano,
      recursoMental: this.recursoMental,
      usaDt: this.usaDt
    });
    return this.close();
  }
}
