import { PYRO } from "../config.mjs";
import { ConstrutorEfeitoApp } from "./../apps/construtor-efeito.mjs";
import { scalingsPadrao, valorScaling, SEM_DANO } from "../magia.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho, flagsDe } from "../sistema.mjs";
import { enriquecer } from "../ui.mjs";
import { rotuloCurtoDoCaminho } from "../data/item-data.mjs";

/**
 * Opções de tipo de dano de um elemento. A primeira herda o tipo do próprio
 * elemento; "Não causa dano" desliga a rolagem, para runas e magias que só
 * produzem efeito (uma barreira, um teleporte, um alcance).
 */
function opcoesTipoDano(padrao) {
  return {
    /*
     * Sem elemento por trás não há tipo a herdar, e a primeira opção passa a
     * ser o dano cru — que é exatamente o que a rolagem faz quando ninguém
     * escolhe. Um gesto não pode cair no tipo do elemento que por acaso está
     * gravado no subtipo dele.
     */
    "": padrao
      ? game.i18n.format("PYRO.Item.TipoDanoPadrao", {
          tipo: game.i18n.localize(PYRO.tiposDano[padrao]?.label ?? `PYRO.Dano.${padrao}`)
        })
      : game.i18n.localize("PYRO.Item.TipoDanoSemTipo"),
    [SEM_DANO]: game.i18n.localize("PYRO.Dano.nenhum"),
    ...Object.fromEntries(Object.entries(PYRO.tiposDano)
      .map(([k, v]) => [k, game.i18n.localize(v.label)])),
    cura: game.i18n.localize("PYRO.Dano.cura")
  };
}

/**
 * A runa rola dados? Elemento sempre pode, pela tabela do próprio elemento.
 * Gesto e modificador só quando alguém deu um escalonamento com faces a eles,
 * e é aí que a escolha do tipo de dano passa a fazer sentido.
 * @param {object[]} [scalings] a cópia de uma magia salva, no lugar dos da runa.
 */
export function rolaDados(sys, scalings = sys?.scalings) {
  if (sys?.tipoRuna === "elemento") return true;
  return (scalings ?? []).some(sc => (sc?.faces ?? 0) > 0);
}

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class PyroItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pyro", "item"],
    position: { width: 620, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      adicionarDano: PyroItemSheet.#adicionarDano,
      removerDano: PyroItemSheet.#removerDano,
      adicionarScaling: PyroItemSheet.#adicionarScaling,
      restaurarScalings: PyroItemSheet.#restaurarScalings,
      removerScaling: PyroItemSheet.#removerScaling,
      adicionarScalingMagia: PyroItemSheet.#adicionarScalingMagia,
      removerScalingMagia: PyroItemSheet.#removerScalingMagia,
      removerAumento: PyroItemSheet.#removerAumento,
      adicionarAfinidade: PyroItemSheet.#adicionarAfinidade,
      removerAfinidade: PyroItemSheet.#removerAfinidade,
      criarEfeito: PyroItemSheet.#criarEfeito,
      editarEfeito: PyroItemSheet.#editarEfeito,
      excluirEfeito: PyroItemSheet.#excluirEfeito,
      alternarEfeito: PyroItemSheet.#alternarEfeito
    }
  };

  /*
   * Três abas: Descrição abre por padrão porque na maior parte do tempo se
   * quer ler o item, não editá-lo. Funcionamento reúne os campos agrupados
   * por bloco, e Efeitos é a lista de Active Effects.
   */
  static PARTS = {
    cabecalho: { template: caminho("templates/item/cabecalho.hbs") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    descricao: { template: caminho("templates/item/tab-descricao.hbs") },
    funcionamento: { template: caminho("templates/item/tab-funcionamento.hbs") },
    efeitos: { template: caminho("templates/item/tab-efeitos.hbs") }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "descricao", icon: "fa-solid fa-align-left" },
        { id: "funcionamento", icon: "fa-solid fa-sliders" },
        { id: "efeitos", icon: "fa-solid fa-bolt" }
      ],
      initial: "descricao",
      labelPrefix: "PYRO.ItemTabs"
    }
  };

  async _preparePartContext(partId, context) {
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /** A ficha do item veste o tema do ator dono; item solto fica na brasa. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.item.actor ?? null);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = item.actor;
    const s = item.system;

    /* --- Runas: elementos têm subtipo (limitado pelas afinidades do mago); */
    /* --- formas e modificadores são gestos de texto livre.                  */
    const ehElemento = item.type === "runa" && s.tipoRuna === "elemento";
    let subtipos = null;
    if (ehElemento) {
      subtipos = Object.fromEntries(Object.entries(PYRO.elementos).map(([k, v]) => [k, v.label]));
      const permitidos = new Set(actor?.system.afinidadesElementos ?? []);
      if (permitidos.size) {
        permitidos.add(s.subtipo); // mantém o valor atual visível
        subtipos = Object.fromEntries(
          Object.entries(subtipos).filter(([k]) => permitidos.has(k))
        );
      }
    }

    /* --- Caminho: dropdown com os caminhos do ator (valor = id) ----------- */
    let caminhoOpts = null;
    if (item.type === "habilidade" && actor) {
      caminhoOpts = { geral: game.i18n.localize("PYRO.CaminhoGeral") };
      for (const c of actor.items.filter(i => i.type === "caminho")) {
        caminhoOpts[c.id] = c.name;
      }
    }

    // Habilidade de caminho com recurso próprio pode morar na aba dele.
    let rotuloAbaCaminho = null;
    if (item.type === "habilidade" && actor) {
      const dono = actor.items.get(s.caminho);
      const temRecurso = (dono?.system.recursos ?? []).some(r => PYRO.recursosCustom?.[r]);
      if (temRecurso) rotuloAbaCaminho = rotuloCurtoDoCaminho(dono);
    }

    /* --- Caminho racial: só o primeiro define o tamanho ------------------- */
    const ehRacial = item.type === "caminho" && s.ehRacial;
    // null em caminho de profissão/classe: lá o tamanho não vem de raça.
    const faixaTamanho = ehRacial ? PYRO.faixaTamanho(s.raca) : null;
    const ehPrimeiroRacial = ehRacial
      && (!actor || actor.system.primeiroRacialId === item.id || actor.system.primeiroRacialId === null);

    Object.assign(context, {
      item,
      system: s,
      systemFields: s.schema.fields,
      config: PYRO,
      subtipos,
      caminhoOpts,
      tiposDano: Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, v.label])),
      linguaOpts: Object.fromEntries(Object.entries(PYRO.linguas).map(([k, v]) => [k, v.label])),
      racaOpts: Object.fromEntries(Object.entries(PYRO.racas).map(([k, v]) => [k, game.i18n.localize(v.label)])),
      // Checkboxes de magia/feitiçaria só em caminhos de profissão/classe e
      // em raças abertas — nas raças fechadas o preset já define.
      mostrarChecksMagia: item.type === "caminho"
        && (!s.ehRacial || (PYRO.racas[s.raca]?.custom ?? true)),
      /*
       * Em caminho racial o dropdown mostra só a faixa da raça, então não dá
       * para gravar um humano gigante sem querer. Um valor já salvo fora da
       * faixa (o mestre estreitou depois) continua na lista, senão o select
       * mostraria uma coisa e a ficha teria outra.
       */
      tamanhoOpts: Object.fromEntries(
        Object.entries(PYRO.tamanhos)
          .filter(([k]) => !faixaTamanho || k === s.tamanho || faixaTamanho.includes(k))
          .map(([k, v]) => [k, v.label])
      ),
      ehRacial,
      ehPrimeiroRacial,
      ehElemento,
      /*
       * Massivo e colossal são faixas, não um tamanho só, então pedem o número
       * de espaços — e é ele que vira o alcance da criatura.
       */
      pedeTamanhoExato: PYRO.pedeTamanhoExato(s.tamanho),
      tamanhoExatoMin: PYRO.tamanhos[s.tamanho]?.exato?.[0] ?? 0,
      tamanhoExatoMax: PYRO.tamanhos[s.tamanho]?.exato?.[1] ?? null,
      /*
       * O lembrete só aparece quando há o que lembrar. Arma média e arma
       * pequena multiplicam por 1, e um aviso de "multiplique por 1" é ruído
       * permanente em quase toda arma do jogo.
       */
      dadosArmaDica: (() => {
        if (item.type !== "arma") return null;
        const cfg = PYRO.tamanhos[s.tamanho];
        if (!cfg || cfg.dadosArma === 1) return null;
        return game.i18n.format("PYRO.Item.DadosArmaDica", {
          tamanho: game.i18n.localize(cfg.label), mult: cfg.dadosArma
        });
      })(),
      // O modo Subjulgar é coisa do elemento Morte (ou de runa já marcada).
      mostrarSubjulgar: ehElemento
        && !!(PYRO.elementos[s.subtipo]?.subjulgar || s.subjulgar),
      /*
       * A lista de tipos aparece sempre que a runa rola dados, seja ela
       * elemento ou não: quem pôs um d6 num gesto precisa dizer de que dano
       * ele é. Só o elemento tem tipo herdado para oferecer como padrão.
       */
      mostrarTipoDano: item.type === "runa" && rolaDados(s),
      tipoDanoOpts: opcoesTipoDano(ehElemento ? PYRO.elementos[s.subtipo]?.tipoDano : null),
      // Runas da magia com a informação de quem pode subjulgar.
      runasMagia: item.type === "magia"
        ? (s.runas ?? []).map(r => {
            const runa = actor?.items.get(r.itemId);
            const cfg = runa?.system.tipoRuna === "elemento"
              ? PYRO.elementos[runa.system.subtipo] : null;
            const padrao = runa?.system.tipoDano || cfg?.tipoDano || "";
            // A cópia guardada na magia manda: ela pode ter ganhado dados que
            // a runa original não tem, e vice-versa.
            const rola = !!runa && rolaDados(runa.system, r.scalings);
            return {
              ...r,
              mostrarSubjulgar: !!(cfg?.subjulgar || r.subjulgar),
              mostrarTipoDano: rola,
              tipoDanoOpts: rola ? opcoesTipoDano(padrao) : null
            };
          })
        : null,
      rotuloPalavra: ehElemento || item.type !== "runa" ? "PYRO.Item.Palavra" : "PYRO.Item.Gesto",
      afinidadeOpts: Object.fromEntries(Object.entries(PYRO.afinidades).map(([k, v]) => [k, v.label])),
      potencialOpts: Object.fromEntries(Object.entries(PYRO.linguas).map(([k, v]) => [k, v.povo ?? v.label])),
      /*
       * Raça pré-definida já traz o potencial mágico da tabela do mundo, e
       * trocar a raça reescreve o campo. Mostrar o select ali seria repetir
       * uma configuração que o jogador não decide. Sobra para caminho de
       * profissão/classe e para raça que o mestre tirou da tabela.
       */
      mostrarPotencial: item.type === "caminho" && s.usaMagia
        && !(s.ehRacial && !!PYRO.racas[s.raca]),
      // Recursos personalizados que este caminho pode conceder.
      rotuloAbaCaminho,
      // Em raças fechadas o preset define os recursos: nada de checkbox.
      mostrarChecksRecursos: item.type === "caminho"
        && (!s.ehRacial || (PYRO.racas[s.raca]?.custom ?? true)),
      recursosOpts: Object.entries(PYRO.recursosCustom ?? {}).map(([chave, cfg]) => ({
        chave,
        label: game.i18n.localize(cfg.label),
        marcado: (s.recursos ?? []).includes(chave)
      })),
      tipoCustoOpts: PYRO.tiposCusto,
      // Passiva e perícia não gastam ação nem recurso: sem bloco de Custos.
      temCustos: item.type === "habilidade" && s.categoria === "ativavel",
      ...(item.type === "habilidade" ? this.#contextoAumentos() : {}),
      ...(item.type === "habilidade" ? this.#contextoRequisitos() : {}),
      // Caminhos e runas têm nome derivado: só leitura no formulário.
      nomeAutomatico: item.type === "caminho" || item.type === "runa",
      // Mochila e item arcano ganham um campo próprio; os demais sabores de
      // equipamento não têm o que mostrar além do que já é comum a todos.
      ehMochila: item.type === "equipamento" && s.categoria === "mochila",
      ehArcano: item.type === "equipamento" && s.categoria === "arcano",
      // Munição só pode ser presa nas costas ou na cintura.
      parteMunicaoOpts: Object.fromEntries(
        PYRO.partesMunicao.map(k => [k, PYRO.partesCorpo[k]])
      ),
      efeitos: item.effects.filter(e => !flagsDe(e)?.deUso),
      efeitosDeUso: item.effects.filter(e => flagsDe(e)?.deUso),
      subtitulo: this.#subtitulo(),
      valoresRapidos: this.#valoresRapidos(),
      // Itens físicos compartilham peso, custo e quantidade.
      temPropriedadesFisicas: ["arma", "equipamento", "consumivel"].includes(item.type),
      // Prévia do que a runa produz nas primeiras Intenções, já com o
      // multiplicador de efeito da língua (a mesma conta da conjuração).
      previaIntencoes: [1, 2, 3, 4, 5],
      previaMult: item.type === "runa" && (PYRO.linguas[s.lingua]?.efeito ?? 1) !== 1
        ? PYRO.linguas[s.lingua].efeito : null,
      previaScalings: item.type === "runa"
        // Marcada como "não causa dano", a runa não rola: some da prévia.
        ? (s.scalings ?? []).filter(sc => !(sc.faces > 0 && s.tipoDano === SEM_DANO)).map(sc => {
            const mult = PYRO.linguas[s.lingua]?.efeito ?? 1;
            return {
              nome: sc.nome || game.i18n.localize("PYRO.Scaling.Efeito"),
              valores: [1, 2, 3, 4, 5].map(n => {
                let v = valorScaling(sc, n);
                if (mult !== 1) v = Math.max(sc.faces > 0 ? 1 : 0, Math.floor(v * mult));
                return sc.faces > 0 ? `${Math.max(0, v)}d${sc.faces}` : v;
              })
            };
          })
        : [],
      tipoLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      pedeDetalhe: item.type === "caminho" && (PYRO.racas[s.raca]?.detalhe ?? false),
      ["is" + item.type.charAt(0).toUpperCase() + item.type.slice(1)]: true,
      descricaoHTML: await enriquecer(s.descricao, item)
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Pré-requisitos (SRD §3): uma habilidade de tier 2 ou mais nasce da fusão
   * de duas do tier imediatamente abaixo.
   *
   * A lista de escolha exclui o que já virou base de outra habilidade, porque
   * cada uma é ingrediente uma vez só. Também exclui a própria habilidade e a
   * que estiver na outra vaga, senão daria para montar uma com ela mesma.
   *
   * O tier 2 é fechado no caminho: as duas origens têm que ser do mesmo
   * caminho da habilidade. Do tier 3 em diante a fusão pode misturar, e é aí
   * que uma tier 2 de mago e uma de espadachim viram algo novo.
   *
   * A habilidade base do caminho fica de fora dos dois lados: ela vem junto do
   * caminho, não é comprada, então não é ingrediente de ninguém nem precisa de
   * ingredientes para subir de tier.
   */
  #contextoRequisitos() {
    const item = this.item;
    const actor = item.actor;
    const s = item.system;
    if (!actor || s.ehBase || (s.tier ?? 1) < 2) return { temRequisitos: false };

    const tierBase = s.tier - 1;
    const mistoPermitido = s.tier >= 3;
    const caminhoAlvo = s.caminho;

    const consumidas = new Set();
    for (const hab of actor.items) {
      if (hab.type !== "habilidade" || hab.id === item.id) continue;
      for (const r of hab.system.requisitos ?? []) if (r.id) consumidas.add(r.id);
    }

    const escolhidas = (s.requisitos ?? []).map(r => r.id).filter(Boolean);
    const nomeDoCaminho = hab => actor.items.get(hab.system.caminho)?.name ?? "";

    const livres = actor.items.filter(hab =>
      hab.type === "habilidade" && hab.id !== item.id && !hab.system.ehBase
      && (hab.system.tier ?? 1) === tierBase && !consumidas.has(hab.id)
      && (mistoPermitido || hab.system.caminho === caminhoAlvo));

    const linhas = [0, 1].map(indice => {
      const atual = escolhidas[indice] ?? "";
      const opcoes = { "": "—" };
      for (const hab of livres) {
        if (escolhidas.includes(hab.id) && hab.id !== atual) continue;
        // O caminho no rótulo só ajuda quando a fusão pode misturar; no
        // tier 2 seria a mesma palavra repetida em todas as linhas.
        const caminho = mistoPermitido ? nomeDoCaminho(hab) : "";
        opcoes[hab.id] = caminho ? `${hab.name} (${caminho})` : hab.name;
      }
      return { indice, atual, opcoes, rotulo: game.i18n.format("PYRO.Item.BaseN", { n: indice + 1 }) };
    });

    return {
      temRequisitos: true,
      tierBase,
      mistoPermitido,
      linhasRequisito: linhas,
      semCandidatos: !livres.length && !escolhidas.length
    };
  }

  /**
   * Aumento de atributo por tier (SRD §3). A ficha mostra as escolhas já
   * feitas e, enquanto sobrar ponto, uma linha vazia para a próxima — cada
   * atributo aparece uma vez só, e o campo de pontos nunca deixa passar do
   * que a habilidade concede.
   */
  #contextoAumentos() {
    const s = this.item.system;
    const total = s.pontosAumento ?? 0;
    const usados = s.pontosUsados ?? 0;
    const restantes = s.pontosRestantes ?? 0;
    const escolhidos = (s.aumentos ?? []).map(a => a.atributo);

    const opcoesPara = atual => Object.fromEntries(
      Object.entries(PYRO.atributos)
        .filter(([k]) => k === atual || !escolhidos.includes(k))
        .map(([k, label]) => [k, game.i18n.localize(label)])
    );

    const linhas = (s.aumentos ?? []).map((a, i) => ({
      index: i,
      atributo: a.atributo,
      pontos: a.pontos,
      // O máximo da linha é o que ela já usa mais o que sobrou.
      max: a.pontos + restantes,
      opcoes: opcoesPara(a.atributo)
    }));

    // Linha nova só enquanto há ponto sobrando e atributo livre.
    const livres = opcoesPara(null);
    const linhaNova = restantes > 0 && Object.keys(livres).length
      ? { index: linhas.length, atributo: "", pontos: "", max: restantes, opcoes: { "": "—", ...livres } }
      : null;

    return {
      temAumentos: total > 0,
      aumentoTotal: total,
      aumentoUsados: usados,
      aumentoRestantes: restantes,
      aumentoResumo: game.i18n.format("PYRO.Item.AumentoPontos", { usados, total }),
      linhasAumento: linhas,
      linhaAumentoNova: linhaNova
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Resumo mecânico do item                                              */
  /* ---------------------------------------------------------------------- */

  /** Linha sob o nome: o essencial do item numa frase ("2d8 cortante · 15/30m"). */
  #subtitulo() {
    const s = this.item.system;
    const loc = k => game.i18n.localize(k);
    const partes = [];

    switch (this.item.type) {
      case "arma": {
        const danos = (s.danos ?? []).filter(d => d.formula?.trim())
          .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo)}`);
        partes.push(...danos);
        partes.push(s.alcanceMaximo > 0
          ? `${s.alcanceMenor}/${s.alcanceMaximo}m` : `${s.alcanceMenor}m`);
        partes.push(`${s.acoes} ${loc("PYRO.AcoesAbrev")}`);
        break;
      }
      case "equipamento": {
        // O sabor vem primeiro quando não é equipamento comum: é o que
        // distingue uma mochila de uma armadura no cabeçalho.
        if (s.categoria && s.categoria !== "equipamento") {
          partes.push(loc(PYRO.categoriasEquipamento[s.categoria] ?? ""));
        }
        partes.push(loc(PYRO.partesCorpo[s.parte] ?? ""));
        if (s.categoria === "mochila" && s.cargaBonus) {
          partes.push(`${loc("PYRO.Item.CargaBonus")} +${s.cargaBonus}`);
        }
        if (s.categoria === "arcano" && s.reducaoMana) {
          partes.push(`${loc("PYRO.Item.ReducaoMana")} -${s.reducaoMana}`);
        }
        for (const [cat, val] of Object.entries(s.defesas?.categorias ?? {})) {
          if (val) partes.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
        }
        for (const [tipo, val] of Object.entries(s.defesas?.tipos ?? {})) {
          if (val) partes.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
        }
        break;
      }
      case "consumivel": {
        if (s.municao) partes.push(loc("PYRO.Item.MunicaoTag"));
        if (s.formula) {
          partes.push(s.municao
            ? `${s.formula} ${loc(PYRO.tiposDano[s.tipoDano]?.label ?? "")}`
            : s.formula);
        }
        break;
      }
      case "habilidade": {
        partes.push(loc(PYRO.categoriasHabilidade[s.categoria] ?? ""));
        partes.push(`${loc("PYRO.Item.Tier")} ${s.tier}`);
        if (s.custoAcoes) {
          partes.push(`${s.custoAcoes} ${loc(`PYRO.Item.Abrev.${s.tipoCusto}`)}`);
        }
        if (s.custoEstamina) partes.push(`${s.custoEstamina} ${loc("PYRO.Abrev.estamina")}`);
        if (s.custoMana) partes.push(`${s.custoMana} ${loc("PYRO.Abrev.mana")}`);
        if (s.custoEnergia) partes.push(`${s.custoEnergia} ${loc("PYRO.Abrev.energia")}`);
        for (const a of s.aumentos ?? []) {
          partes.push(`+${a.pontos} ${loc(PYRO.atributos[a.atributo] ?? a.atributo)}`);
        }
        break;
      }
      case "feitico": {
        if (s.custoAcoes) partes.push(`${s.custoAcoes} ${loc("PYRO.AcoesAbrev")}`);
        if (s.formula) partes.push(s.formula);
        break;
      }
      case "runa": {
        partes.push(loc(PYRO.tiposRuna[s.tipoRuna] ?? ""));
        if (s.tipoRuna === "elemento") {
          partes.push(loc(PYRO.elementos[s.subtipo]?.label ?? ""));
          if (s.tipoDano === SEM_DANO) partes.push(loc("PYRO.Dano.nenhum"));
          if (s.subjulgar) partes.push(loc("PYRO.Item.SubjulgarCurto"));
        }
        partes.push(loc(PYRO.linguas[s.lingua]?.label ?? ""));
        break;
      }
      case "magia": {
        partes.push(...(s.runas ?? []).map(r => r.nome));
        break;
      }
      case "caminho": {
        partes.push(loc(s.ehRacial ? "PYRO.Item.EhRacial" : "PYRO.Caminhos.profissaoClasse"));
        // No resumo o rótulo é a vocação, não a pergunta do checkbox.
        if (s.usaMagia) partes.push(loc("PYRO.Item.Mago"));
        if (s.usaFeiticaria) partes.push(loc("PYRO.Item.Feiticeiro"));
        break;
      }
    }
    return partes.filter(Boolean).join(" · ");
  }

  /** Coluna estreita ao lado da descrição: o que se consulta sem editar. */
  #valoresRapidos() {
    const s = this.item.system;
    const loc = k => game.i18n.localize(k);
    const linhas = [];
    const add = (label, valor) => linhas.push({ label: loc(label), valor });

    if ("quantidade" in s) add("PYRO.Quantidade", s.quantidade);
    if ("peso" in s) {
      add("PYRO.Peso", s.municao ? `${s.peso} (${loc("PYRO.Item.PesoLote")})` : s.peso);
    }
    if ("custo" in s) add("PYRO.Item.Custo", s.custo);
    if ("equipado" in s) {
      add("PYRO.Item.Equipado", loc(s.equipado ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "arma") {
      add("PYRO.Item.Maos", s.maos);
      add("PYRO.Item.UsaMunicao", loc(s.usaMunicao ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "habilidade") {
      add("PYRO.Item.CustoXp", s.ehBase ? loc("PYRO.Item.BaseTag") : s.custoXp);
    }
    if (this.item.type === "caminho") {
      add("PYRO.Item.Xp", `${s.xpDisponivel} / ${s.xp}`);
      add("PYRO.Item.XpGasta", s.xpGasta);
      add("PYRO.ProximoCusto", s.proximoCusto);
    }
    return linhas;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * expandObject transforma inputs indexados (system.tiposDano.0,
   * system.runas.1.scalings.0.base) em objetos com chaves numéricas.
   * Reconstitui os arrays antes do update, senão os ArrayFields quebram.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = data.system ?? {};

    if (this.item.type === "arma" && sys.danos && !Array.isArray(sys.danos)) {
      sys.danos = Object.values(sys.danos).map(d => ({
        formula: d.formula ?? "", tipo: d.tipo ?? "impacto"
      }));
    }

    if (this.item.type === "caminho" && sys.recursos && !Array.isArray(sys.recursos)) {
      // Checkboxes chegam como { chave: true/false }.
      sys.recursos = Object.entries(sys.recursos).filter(([, v]) => v).map(([k]) => k);
    }

    if (this.item.type === "caminho" && sys.afinidades && !Array.isArray(sys.afinidades)) {
      sys.afinidades = Object.values(sys.afinidades).map(a => ({
        tipo: a.tipo ?? "fogo",
        outro: a.outro ?? ""
      }));
    }

    if (this.item.type === "habilidade" && sys.aumentos && !Array.isArray(sys.aumentos)) {
      const teto = Math.max(0, (sys.tier ?? this.item.system.tier) - 1);
      let gasto = 0;
      const vistos = new Set();
      sys.aumentos = Object.values(sys.aumentos)
        .map(a => ({ atributo: a.atributo ?? "", pontos: Number(a.pontos) || 0 }))
        .filter(a => {
          if (!a.atributo || a.pontos <= 0 || vistos.has(a.atributo)) return false;
          // Nunca passa do que o tier concede, mesmo com edição simultânea.
          a.pontos = Math.min(a.pontos, teto - gasto);
          if (a.pontos <= 0) return false;
          gasto += a.pontos;
          vistos.add(a.atributo);
          return true;
        });
    }

    /*
     * Os dois selects de pré-requisito chegam como { 0: id, 1: id }. Vaga
     * vazia e repetição saem fora, e o nome é resolvido agora para a ligação
     * sobreviver a um id que mude.
     */
    if (this.item.type === "habilidade" && sys.requisitos && !Array.isArray(sys.requisitos)) {
      const actor = this.item.actor;
      const vistos = new Set();
      const ids = [];
      for (const valor of Object.values(sys.requisitos)) {
        const id = typeof valor === "string" ? valor : (valor?.id ?? "");
        if (!id || vistos.has(id)) continue;
        vistos.add(id);
        ids.push(id);
      }
      sys.requisitos = ids.slice(0, 2)
        .map(id => ({ id, nome: actor?.items.get(id)?.name ?? "" }));
    }

    if (this.item.type === "runa" && sys.scalings && !Array.isArray(sys.scalings)) {
      const atuais = this.item.system.toObject().scalings;
      sys.scalings = Object.values(sys.scalings)
        .map((sc, i) => ({ ...(atuais[i] ?? {}), ...sc }));
    }

    if (this.item.type === "magia" && sys.runas && !Array.isArray(sys.runas)) {
      const atuais = this.item.system.toObject().runas;
      const form = sys.runas;
      sys.runas = atuais.map((base, i) => {
        const r = form[i] ?? {};
        let scalings = base.scalings ?? [];
        if (r.scalings && !Array.isArray(r.scalings)) {
          scalings = Object.values(r.scalings).map((sc, j) => ({ ...(scalings[j] ?? {}), ...sc }));
        }
        return { ...base, ...r, scalings };
      });
    }

    return data;
  }

  /* ---------------------------------------------------------------------- */
  /*  Actions de arrays                                                     */
  /* ---------------------------------------------------------------------- */

  static async #adicionarDano() {
    const arr = this.item.system.toObject().danos;
    arr.push({ formula: "1d6", tipo: "impacto" });
    await this.item.update({ "system.danos": arr });
  }

  static async #removerDano(event, target) {
    const arr = this.item.system.toObject().danos;
    arr.splice(Number(target.dataset.index), 1);
    if (!arr.length) arr.push({ formula: "1d6", tipo: "impacto" });
    await this.item.update({ "system.danos": arr });
  }

  static async #adicionarScaling() {
    const arr = this.item.system.toObject().scalings;
    arr.push({ nome: "", base: 0, porIntencao: 0, faces: 0 });
    await this.item.update({ "system.scalings": arr });
  }

  /**
   * Repõe o que as regras dão para este elemento ou gesto. Serve quando o
   * jogador mexeu demais nos números ou quando o mestre editou as tabelas.
   */
  static async #restaurarScalings() {
    await this.item.update({ "system.scalings": scalingsPadrao(this.item) });
  }

  static async #removerScaling(event, target) {
    const arr = this.item.system.toObject().scalings;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.scalings": arr });
  }

  static async #adicionarScalingMagia(event, target) {
    const runas = this.item.system.toObject().runas;
    const r = runas[Number(target.dataset.runa)];
    if (!r) return;
    r.scalings.push({ nome: "", base: 0, porIntencao: 0, faces: 0 });
    await this.item.update({ "system.runas": runas });
  }

  static async #removerScalingMagia(event, target) {
    const runas = this.item.system.toObject().runas;
    const r = runas[Number(target.dataset.runa)];
    if (!r) return;
    r.scalings.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.runas": runas });
  }

  static async #removerAumento(event, target) {
    const arr = this.item.system.toObject().aumentos;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.aumentos": arr });
  }

  static async #adicionarAfinidade() {
    const arr = this.item.system.toObject().afinidades;
    arr.push({ tipo: "fogo", outro: "" });
    await this.item.update({ "system.afinidades": arr });
  }

  static async #removerAfinidade(event, target) {
    const arr = this.item.system.toObject().afinidades;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.afinidades": arr });
  }

  /* --- Active Effects no item (transferem pro ator dono) ----------------- */

  static #criarEfeito() {
    new ConstrutorEfeitoApp({ documento: this.item }).render(true);
  }

  /** Editar reabre o construtor do PYRO, não a ficha padrão (ver actor-sheet). */
  static #editarEfeito(event, target) {
    const efeito = this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
    if (efeito) new ConstrutorEfeitoApp({ efeito }).render(true);
  }

  static async #excluirEfeito(event, target) {
    await this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId)?.delete();
  }

  static async #alternarEfeito(event, target) {
    const ef = this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
    if (ef) await ef.update({ disabled: !ef.disabled });
  }
}
