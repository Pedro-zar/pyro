/*
 * Ficha de item: contexto de cada tipo (runa, magia, caminho, habilidade…) e
 * a reconstrução dos arrays do formulário antes do update.
 */
import { PYRO } from "../config.mjs";
import { ConstrutorEfeitoApp } from "./../apps/construtor-efeito.mjs";
import { scalingsPadrao, valorScaling, chaveVariavel, SEM_DANO } from "../magia.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho, flagsDe } from "../sistema.mjs";
import { enriquecer } from "../ui.mjs";
import { calcularFormula } from "../dados.mjs";
import { descreverRequisito } from "../progressao.mjs";
import { rotuloCurtoDoCaminho, configDoRecurso, nivelDoRecurso } from "../data/item-data.mjs";
import {
  tracosCompativeis, valorDoTraco, textoDoValor, ataquesDoAtor, posturasDoAtor, opcoesDoFiltro,
  acoesBaseDaArma
} from "../tecnica.mjs";

/**
 * Opções de tipo de dano de um elemento. A primeira herda o tipo do próprio
 * elemento; "Não causa dano" desliga a rolagem, para runas e magias que só
 * produzem efeito (uma barreira, um teleporte, um alcance).
 */
function opcoesTipoDano() {
  return {
    [SEM_DANO]: game.i18n.localize("PYRO.Dano.nenhum"),
    ...Object.fromEntries(Object.entries(PYRO.tiposDano)
      .map(([k, v]) => [k, game.i18n.localize(v.label)])),
    cura: game.i18n.localize("PYRO.Dano.cura")
  };
}

/**
 * O tipo de dano que a lista deve mostrar como escolhido.
 *
 * A opção "padrão do elemento" saiu: em vez de uma entrada extra que só diz
 * "o que o elemento mandar", a lista já vem no tipo concreto. É o que faz
 * duas runas de calor somarem o dano no card — comparar tipos herdados de
 * origens diferentes nunca ia bater.
 */
function tipoDanoEscolhido(sys) {
  if (sys.tipoDano) return sys.tipoDano;
  const cfg = sys.tipoRuna === "elemento" ? PYRO.elementos[sys.subtipo] : null;
  return cfg?.tipoDano || "impacto";
}

/**
 * A runa produz dano? É o que decide se a escolha do tipo aparece na ficha.
 *
 * Só a Intenção chamada "Dano" conta. Rolar dados não basta: o muro rola PV e
 * o raio rola corrente, e nenhum dos dois pede tipo de dano — perguntar ali
 * seria oferecer uma escolha que não muda nada.
 */
export function produzDano(sys, scalings = sys?.scalings) {
  return (scalings ?? []).some(sc => chaveVariavel(sc?.nome) === "dano");
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
      adicionarAfinidade: PyroItemSheet.#adicionarAfinidade,
      removerAfinidade: PyroItemSheet.#removerAfinidade,
      adicionarTraco: PyroItemSheet.#adicionarTraco,
      removerTraco: PyroItemSheet.#removerTraco,
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
    efeitos: { template: caminho("templates/item/tab-efeitos.hbs") },
    recursos: { template: caminho("templates/item/tab-recursos.hbs") }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "descricao", icon: "fa-solid fa-align-left" },
        { id: "funcionamento", icon: "fa-solid fa-sliders" },
        { id: "efeitos", icon: "fa-solid fa-bolt" },
        // Só nasce em Caminho que concede recurso; ver #recursosDoCaminho.
        { id: "recursos", icon: "fa-solid fa-droplet" }
      ],
      initial: "descricao",
      labelPrefix: "PYRO.ItemTabs"
    }
  };

  /**
   * Recursos que este Caminho concede, com a fórmula e a habilidade de nível
   * de cada um. Vazio em qualquer outro item — é o que decide se a aba existe.
   */
  #recursosDoCaminho() {
    const item = this.item;
    if (item.type !== "caminho") return [];
    const actor = item.actor;
    const daFicha = actor?.items.filter(i =>
      i.type === "habilidade" && i.system.caminho === item.id) ?? [];

    return (item.system.recursos ?? [])
      .filter(chave => PYRO.recursosCustom?.[chave])
      .map(chave => {
        const cfg = PYRO.recursosCustom[chave];
        const conf = configDoRecurso(item, chave);
        const dados = actor ? { ...actor.getRollData(), nvl: nivelDoRecurso(actor, item, chave) } : null;
        // A habilidade gravada entra na lista mesmo que ela tenha trocado de
        // Caminho: sumir da lista faria o select gravar "nenhuma" sozinho.
        const escolhida = actor?.items.get(conf.habilidadeId);
        const lista = escolhida && !daFicha.includes(escolhida) ? [...daFicha, escolhida] : daFicha;
        return {
          chave,
          nome: game.i18n.localize(cfg.label),
          formula: conf.propria ? conf.formula : "",
          padrao: cfg.formula ?? "",
          habilidadeId: conf.habilidadeId,
          // Fora de uma ficha não há habilidade nenhuma para apontar, e o
          // select nem aparece (ver o template).
          temHabilidades: !!actor,
          habilidades: Object.fromEntries(lista.map(h => [h.id, h.name])),
          // O número que a fórmula dá nesta ficha: confere na hora de escrever.
          // Item fora de ficha não tem em quem calcular, e a linha não sai.
          temValor: !!dados,
          valor: dados
            ? Math.floor(calcularFormula(conf.formula, dados) * (actor.system.multi ?? 1))
              + (actor.system.recursos?.[chave]?.bonus ?? 0)
            : 0
        };
      });
  }

  /**
   * A aba de recursos só existe no Caminho que concede algum.
   *
   * A parte continua sendo renderizada mesmo sem recurso nenhum: tirá-la da
   * lista de partes não a apaga do DOM, e a seção velha continuaria mandando
   * os campos dela no próximo salvamento. Sem recurso, o template não desenha
   * campo algum.
   */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (group !== "primary") return tabs;

    const recursos = this.#recursosDoCaminho();
    if (!recursos.length) {
      delete tabs.recursos;
      // Aba ativa que deixou de existir (o recurso saiu da raça) deixaria a
      // ficha em branco: a Descrição é o lugar de sempre.
      if (this.tabGroups.primary === "recursos" && tabs.descricao) {
        this.tabGroups.primary = "descricao";
        tabs.descricao.active = true;
        tabs.descricao.cssClass = "active";
      }
      return tabs;
    }
    /*
     * Com um recurso só, a aba leva o nome dele ("Energia Natural"): é assim
     * que a mesa chama a coisa, e "Recursos" seria um rótulo a mais para ler.
     */
    if (recursos.length === 1) tabs.recursos.label = recursos[0].nome;
    return tabs;
  }

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
    const sys = item.system;

    /*
     * Elemento tem subtipo, que é a linha da tabela de dano; gesto não tem, e
     * o que o sistema reconhece nele é o nome (um gesto chamado Toque empresta
     * Intenção, venha ele do compêndio ou da mão do jogador).
     */
    const ehElemento = item.type === "runa" && sys.tipoRuna === "elemento";
    let subtipos = null;
    if (ehElemento) {
      subtipos = Object.fromEntries(Object.entries(PYRO.elementos).map(([k, v]) => [k, v.label]));
      // O mago só escreve runas dos elementos com que tem afinidade.
      const permitidos = new Set(actor?.system.afinidadesElementos ?? []);
      if (permitidos.size) {
        permitidos.add(sys.subtipo); // mantém o valor atual visível
        subtipos = Object.fromEntries(
          Object.entries(subtipos).filter(([chave]) => permitidos.has(chave))
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
      const dono = actor.items.get(sys.caminho);
      const temRecurso = (dono?.system.recursos ?? []).some(r => PYRO.recursosCustom?.[r]);
      if (temRecurso) rotuloAbaCaminho = rotuloCurtoDoCaminho(dono);
    }

    /* --- Caminho racial: só o primeiro define o tamanho ------------------- */
    const ehRacial = item.type === "caminho" && sys.ehRacial;
    // null em caminho de profissão/classe: lá o tamanho não vem de raça.
    const faixaTamanho = ehRacial ? PYRO.faixaTamanho(sys.raca) : null;
    const ehPrimeiroRacial = ehRacial
      && (!actor || actor.system.primeiroRacialId === item.id || actor.system.primeiroRacialId === null);

    Object.assign(context, {
      item,
      system: sys,
      systemFields: sys.schema.fields,
      config: PYRO,
      subtipos,
      caminhoOpts,
      tiposDano: Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, v.label])),
      linguaOpts: Object.fromEntries(Object.entries(PYRO.linguas).map(([k, v]) => [k, v.label])),
      racaOpts: Object.fromEntries(Object.entries(PYRO.racas).map(([k, v]) => [k, game.i18n.localize(v.label)])),
      // Checkboxes de magia/feitiçaria só em caminhos de profissão/classe e
      // em raças abertas — nas raças fechadas o preset já define.
      mostrarChecksMagia: item.type === "caminho"
        && (!sys.ehRacial || (PYRO.racas[sys.raca]?.custom ?? true)),
      /*
       * Em caminho racial o dropdown mostra só a faixa da raça, então não dá
       * para gravar um humano gigante sem querer. Um valor já salvo fora da
       * faixa (o mestre estreitou depois) continua na lista, senão o select
       * mostraria uma coisa e a ficha teria outra.
       */
      tamanhoOpts: Object.fromEntries(
        Object.entries(PYRO.tamanhos)
          .filter(([k]) => !faixaTamanho || k === sys.tamanho || faixaTamanho.includes(k))
          .map(([k, v]) => [k, v.label])
      ),
      ehRacial,
      ehPrimeiroRacial,
      ehElemento,
      /*
       * Massivo e colossal são faixas, não um tamanho só, então pedem o número
       * de espaços — e é ele que vira o alcance da criatura.
       */
      pedeTamanhoExato: PYRO.pedeTamanhoExato(sys.tamanho),
      tamanhoExatoMin: PYRO.tamanhos[sys.tamanho]?.exato?.[0] ?? 0,
      tamanhoExatoMax: PYRO.tamanhos[sys.tamanho]?.exato?.[1] ?? null,
      /*
       * O lembrete só aparece quando há o que lembrar. Arma média e arma
       * pequena multiplicam por 1, e um aviso de "multiplique por 1" é ruído
       * permanente em quase toda arma do jogo.
       */
      dadosArmaDica: (() => {
        if (item.type !== "arma") return null;
        const cfg = PYRO.tamanhos[sys.tamanho];
        if (!cfg || cfg.dadosArma === 1) return null;
        return game.i18n.format("PYRO.Item.DadosArmaDica", {
          tamanho: game.i18n.localize(cfg.label), mult: cfg.dadosArma
        });
      })(),
      // O modo Subjulgar é coisa do elemento Morte (ou de runa já marcada).
      // Só o elemento tem tabela para repor; o gesto veio do compêndio com os
      // números dele, e restaurar apagaria o que o jogador tem.
      podeRestaurarScalings: ehElemento,
      mostrarSubjulgar: ehElemento
        && !!(PYRO.elementos[sys.subtipo]?.subjulgar || sys.subjulgar),
      /*
       * A lista de tipos aparece sempre que a runa rola dados, seja ela
       * elemento ou não: quem pôs um d6 num gesto precisa dizer de que dano
       * ele é. Só o elemento tem tipo herdado para oferecer como padrão.
       */
      mostrarTipoDano: item.type === "runa" && produzDano(sys),
      tipoDanoSelecionado: item.type === "runa" ? tipoDanoEscolhido(sys) : "",
      tipoDanoOpts: opcoesTipoDano(),
      runasMagia: item.type === "magia"
        ? (sys.runas ?? []).map(r => {
            const runa = actor?.items.get(r.itemId);
            const cfg = runa?.system.tipoRuna === "elemento"
              ? PYRO.elementos[runa.system.subtipo] : null;
            // A cópia guardada na magia manda: ela pode ter ganhado Intenções
            // que a runa original não tem, e vice-versa.
            const rola = !!runa && produzDano(runa.system, r.scalings);
            return {
              ...r,
              mostrarSubjulgar: !!(cfg?.subjulgar || r.subjulgar),
              mostrarTipoDano: rola,
              tipoDanoSelecionado: r.tipoDano || cfg?.tipoDano || "impacto",
              tipoDanoOpts: rola ? opcoesTipoDano() : null
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
      mostrarPotencial: item.type === "caminho" && sys.usaMagia
        && !(sys.ehRacial && !!PYRO.racas[sys.raca]),
      rotuloAbaCaminho,
      // Em raças fechadas o preset define os recursos: nada de checkbox.
      mostrarChecksRecursos: item.type === "caminho"
        && (!sys.ehRacial || (PYRO.racas[sys.raca]?.custom ?? true)),
      recursosOpts: Object.entries(PYRO.recursosCustom ?? {}).map(([chave, cfg]) => ({
        chave,
        label: game.i18n.localize(cfg.label),
        marcado: (sys.recursos ?? []).includes(chave)
      })),
      tipoCustoOpts: PYRO.tiposCusto,
      // Passiva, postura e perícia não gastam ação nem recurso ao serem
      // usadas: sem bloco de Custos.
      temCustos: item.type === "habilidade" && PYRO.cobraCustoDeUso(sys),
      // Ranque com a descrição de escopo do SRD como dica de cada opção.
      ranqueOpts: Object.fromEntries(Object.entries(PYRO.ranques)
        .map(([t, label]) => [t, `${t} — ${game.i18n.localize(label)}`])),
      // Despertar é regra opcional: sem ela ligada, o campo nem aparece.
      mostrarAdormecida: item.type === "habilidade" && PYRO.regraAtiva("despertar"),
      // Caminhos e runas têm nome derivado: só leitura no formulário.
      nomeAutomatico: item.type === "caminho" || item.type === "runa",
      // Mochila e item arcano ganham um campo próprio; os demais sabores de
      // equipamento não têm o que mostrar além do que já é comum a todos.
      ehMochila: item.type === "equipamento" && sys.categoria === "mochila",
      ehArcano: item.type === "equipamento" && sys.categoria === "arcano",
      // Munição só pode ser presa nas costas ou na cintura.
      parteMunicaoOpts: Object.fromEntries(
        PYRO.partesMunicao.map(k => [k, PYRO.partesCorpo[k]])
      ),
      efeitos: item.effects.filter(e => !flagsDe(e)?.deUso),
      efeitosDeUso: item.effects.filter(e => flagsDe(e)?.deUso),
      subtitulo: this.#subtitulo(),
      // Perícia: uma caixa por atributo que ela aceita.
      atributosPericia: item.type === "pericia"
        ? Object.entries(PYRO.atributos).map(([chave, label]) => ({
            chave, label: game.i18n.localize(label), marcado: sys.atributos.includes(chave)
          }))
        : null,
      recursosDoCaminho: this.#recursosDoCaminho(),
      ...this.#contextoTecnica(),
      requisito: descreverRequisito(item),
      valoresRapidos: this.#valoresRapidos(),
      temPropriedadesFisicas: ["arma", "equipamento", "consumivel"].includes(item.type),
      // O bloco final junta peso/custo/quantidade com as marcas de cada tipo.
      // Magia e técnica não têm nem uma coisa nem outra, e o bloco vazio só
      // ocuparia espaço no fim da aba.
      mostrarPropriedades: !["magia", "tecnica"].includes(item.type),
      /*
       * Dano mental consome recurso, não Vida (SRD §6). O campo só aparece na
       * arma que de fato tem uma parcela mental — nas outras seria uma escolha
       * sem efeito nenhum.
       */
      mostrarRecursoMental: item.type === "arma"
        && (sys.danos ?? []).some(d => PYRO.tiposDano[d.tipo]?.categoria === "mental"),
      recursosMentaisOpts: Object.fromEntries(Object.entries(PYRO.recursosDrenaveis())
        .map(([k, label]) => [k, game.i18n.localize(label)])),
      // Prévia do que a runa produz nas primeiras Intenções, já com o
      // multiplicador de efeito da língua (a mesma conta da conjuração).
      previaIntencoes: [1, 2, 3, 4, 5],
      previaMult: item.type === "runa" && (PYRO.linguas[sys.lingua]?.efeito ?? 1) !== 1
        ? PYRO.linguas[sys.lingua].efeito : null,
      previaScalings: item.type === "runa"
        // Marcada como "não causa dano", a runa não rola: some da prévia.
        ? (sys.scalings ?? []).filter(sc => !(sc.faces > 0 && sys.tipoDano === SEM_DANO)).map(sc => {
            const mult = PYRO.linguas[sys.lingua]?.efeito ?? 1;
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
      pedeDetalhe: item.type === "caminho" && (PYRO.racas[sys.raca]?.detalhe ?? false),
      ["is" + item.type.charAt(0).toUpperCase() + item.type.slice(1)]: true,
      descricaoHTML: await enriquecer(sys.descricao, item)
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */
  /*  Técnica                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Campos da técnica: pontos de criação, traços comprados, filtro da
   * especificidade e uma linha de variação por postura que o dono conhece.
   * Devolve um objeto vazio nos outros tipos, para o Object.assign do contexto
   * não carregar chaves que ninguém vai ler.
   */
  #contextoTecnica() {
    const item = this.item;
    if (item.type !== "tecnica") return {};
    const sys = item.system;
    const actor = item.actor;
    const loc = k => game.i18n.localize(k);

    const espec = PYRO.especificidades[sys.especificidade];
    const compativeis = tracosCompativeis(sys.acaoBase);
    // Um traço entra uma vez só: repetir a linha não soma nada, quem sobe é o grau.
    const jaUsados = new Set((sys.tracos ?? []).map(t => t.chave));

    const opcoesFiltro = opcoesDoFiltro(sys.especificidade);

    // O custo em ações vem junto: é ele que vira a base da conta de pontos, e
    // o seletor mostra o número ao lado do nome para a escolha ser informada.
    const ataques = espec?.filtro === "ataque" && actor
      ? ataquesDoAtor(actor).map(a => ({ id: a.id, nome: a.nome, acoes: a.acoes }))
      : null;

    return {
      pontos: sys.pontos,
      // O aviso é só aviso: a técnica com pontos sobrando ainda está sendo
      // montada, e a que passou do teto é uma conversa com o mestre.
      pontosSobrando: sys.pontos.restantes > 0,
      pontosExcedidos: sys.pontos.restantes < 0,
      /*
       * Total negativo é outra coisa que gastar demais: a técnica é mais rápida
       * do que a arma aguenta, e nem sem traço nenhum ela fecha. O aviso diz
       * isso, senão o jogador procuraria o erro nos traços.
       */
      pontosImpossiveis: sys.pontos.disponiveis < 0,
      acoesBaseOpts: Object.fromEntries(
        Object.entries(PYRO.acoesBaseTecnica).map(([k, v]) => [k, v.label])),
      /*
       * A base da conta de ações é a arma escolhida, e só existe na
       * especificidade "arma específica" (ver acoesBaseDaArma em tecnica.mjs).
       * Sem ela o campo mostra o porquê, em vez de um número que não vale.
       */
      acoesDaBase: acoesBaseDaArma(sys),
      // Com sinal: o número diz sozinho se a diferença dá ou custa ponto.
      pontosDeAcoes: sys.pontos?.dasAcoes
        ? `${sys.pontos.dasAcoes > 0 ? "+" : ""}${sys.pontos.dasAcoes}`
        : "",
      especificidadeOpts: Object.fromEntries(Object.entries(PYRO.especificidades)
        .map(([k, v]) => [k, `${loc(v.label)} (+${v.pontos})`])),
      filtroOpts: opcoesFiltro
        ? Object.fromEntries(Object.entries(opcoesFiltro).map(([k, v]) => [k, loc(v)]))
        : null,
      /*
       * A opção vazia é o estado inicial de verdade: sem ela o seletor mostra
       * a primeira arma da ficha enquanto o dado gravado é "", e escolher
       * justamente essa arma não dispara mudança nenhuma — a técnica ficaria
       * sem arma para sempre, e o Executor abriria sem ataque disponível.
       */
      ataquesOpts: ataques
        ? { "": loc("PYRO.Tecnica.EscolherArma"),
            ...Object.fromEntries(ataques.map(a => [a.id, `${a.nome} (${a.acoes})`])) }
        : null,
      tracosDaTecnica: (sys.tracos ?? []).map((t, indice) => {
        const cfg = PYRO.tracosTecnica[t.chave];
        return {
          indice,
          chave: t.chave,
          grau: t.grau,
          custo: PYRO.custoDoGrau(t.grau),
          desconhecido: !cfg,
          // O que o grau comprado rende com Esforço 1, que é a leitura útil
          // na hora de montar: o Esforço é escolha da execução.
          efeito: cfg ? textoDoValor(cfg, valorDoTraco(cfg, t.grau, 1)) : "",
          // A lista de cada linha traz os traços livres mais o próprio, senão
          // o select mostraria vazio no traço já escolhido.
          opcoes: Object.fromEntries(compativeis
            .filter(c => c.chave === t.chave || !jaUsados.has(c.chave))
            .map(c => [c.chave, loc(c.label)]))
        };
      }),
      podeAdicionarTraco: compativeis.some(c => !jaUsados.has(c.chave)),
      onusOpts: Object.entries(PYRO.onusTecnica).map(([chave, cfg]) => ({
        chave,
        label: `${loc(cfg.label)} (+${cfg.pontos})`,
        marcado: (sys.onus ?? []).includes(chave)
      })),
      /*
       * Uma variação por postura conhecida, montada a partir das posturas do
       * ator: a lista não é editada à mão porque ela é consequência de quais
       * posturas o personagem tem, e some junto com elas.
       */
      variacoesPostura: (posturasDoAtor(actor) ?? []).map(p => ({
        id: p.id,
        nome: p.name,
        texto: (sys.variacoes ?? []).find(v => v.posturaId === p.id)?.texto ?? ""
      }))
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Resumo mecânico do item                                              */
  /* ---------------------------------------------------------------------- */

  /** Linha sob o nome: o essencial do item numa frase ("2d8 cortante · 15/30m"). */
  #subtitulo() {
    const sys = this.item.system;
    const loc = k => game.i18n.localize(k);
    const partes = [];

    switch (this.item.type) {
      case "arma": {
        const danos = (sys.danos ?? []).filter(d => d.formula?.trim())
          .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo)}`);
        partes.push(...danos);
        partes.push(sys.alcanceMaximo > 0
          ? `${sys.alcanceMenor}/${sys.alcanceMaximo}m` : `${sys.alcanceMenor}m`);
        partes.push(`${sys.acoes} ${loc("PYRO.AcoesAbrev")}`);
        break;
      }
      case "equipamento": {
        // O sabor vem primeiro quando não é equipamento comum: é o que
        // distingue uma mochila de uma armadura no cabeçalho.
        if (sys.categoria && sys.categoria !== "equipamento") {
          partes.push(loc(PYRO.categoriasEquipamento[sys.categoria] ?? ""));
        }
        partes.push(loc(PYRO.partesCorpo[sys.parte] ?? ""));
        if (sys.categoria === "mochila" && sys.cargaBonus) {
          partes.push(`${loc("PYRO.Item.CargaBonus")} +${sys.cargaBonus}`);
        }
        if (sys.categoria === "arcano" && sys.reducaoMana) {
          partes.push(`${loc("PYRO.Item.ReducaoMana")} -${sys.reducaoMana}`);
        }
        for (const [cat, val] of Object.entries(sys.defesas?.categorias ?? {})) {
          if (val) partes.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
        }
        for (const [tipo, val] of Object.entries(sys.defesas?.tipos ?? {})) {
          if (val) partes.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
        }
        break;
      }
      case "consumivel": {
        if (sys.municao) partes.push(loc("PYRO.Item.MunicaoTag"));
        if (sys.formula) {
          partes.push(sys.municao
            ? `${sys.formula} ${loc(PYRO.tiposDano[sys.tipoDano]?.label ?? "")}`
            : sys.formula);
        }
        break;
      }
      case "habilidade": {
        partes.push(loc(PYRO.categoriasHabilidade[sys.categoria] ?? ""));
        partes.push(`${loc("PYRO.Item.Ranque")} ${sys.ranque}`);
        partes.push(`${loc("PYRO.Uso.Nivel")} ${sys.nivel}`);
        if (sys.custoAcoes) {
          partes.push(`${sys.custoAcoes} ${loc(`PYRO.Item.Abrev.${sys.tipoCusto}`)}`);
        }
        if (sys.custoEstamina) partes.push(`${sys.custoEstamina} ${loc("PYRO.Abrev.estamina")}`);
        if (sys.custoMana) partes.push(`${sys.custoMana} ${loc("PYRO.Abrev.mana")}`);
        if (sys.custoEnergia) partes.push(`${sys.custoEnergia} ${loc("PYRO.Abrev.energia")}`);
        if (sys.adormecidaAtiva) partes.push(loc("PYRO.Despertar.Tag"));
        break;
      }
      case "tecnica": {
        partes.push(loc(PYRO.acoesBaseTecnica[sys.acaoBase]?.label ?? ""));
        partes.push(`${loc("PYRO.Item.Ranque")} ${sys.ranque}`);
        partes.push(`${loc("PYRO.Uso.Nivel")} ${sys.progresso.nivel}`);
        partes.push(`${sys.acoes} ${loc("PYRO.AcoesAbrev")}`);
        break;
      }
      case "pericia": {
        partes.push(sys.atributos.map(k => loc(PYRO.atributos[k])).join("/"));
        partes.push(`${loc("PYRO.Uso.Nivel")} ${sys.progresso.nivel}`);
        if (!sys.aprendida) partes.push(loc("PYRO.Pericia.SemTreinoTag"));
        break;
      }
      case "feitico": {
        if (sys.custoAcoes) partes.push(`${sys.custoAcoes} ${loc("PYRO.AcoesAbrev")}`);
        if (sys.formula) partes.push(sys.formula);
        break;
      }
      case "runa": {
        partes.push(loc(PYRO.tiposRuna[sys.tipoRuna] ?? ""));
        if (sys.tipoRuna === "elemento") {
          partes.push(loc(PYRO.elementos[sys.subtipo]?.label ?? ""));
          if (sys.tipoDano === SEM_DANO) partes.push(loc("PYRO.Dano.nenhum"));
          if (sys.subjulgar) partes.push(loc("PYRO.Item.SubjulgarCurto"));
        }
        partes.push(loc(PYRO.linguas[sys.lingua]?.label ?? ""));
        break;
      }
      case "magia": {
        partes.push(...(sys.runas ?? []).map(r => r.nome));
        break;
      }
      case "caminho": {
        partes.push(loc(sys.ehRacial ? "PYRO.Item.EhRacial" : "PYRO.Caminhos.profissaoClasse"));
        // No resumo o rótulo é a vocação, não a pergunta do checkbox.
        if (sys.usaMagia) partes.push(loc("PYRO.Item.Mago"));
        if (sys.usaFeiticaria) partes.push(loc("PYRO.Item.Feiticeiro"));
        break;
      }
    }
    return partes.filter(Boolean).join(" · ");
  }

  /** Coluna estreita ao lado da descrição: o que se consulta sem editar. */
  #valoresRapidos() {
    const sys = this.item.system;
    const loc = k => game.i18n.localize(k);
    const linhas = [];
    const add = (label, valor) => linhas.push({ label: loc(label), valor });

    if ("quantidade" in sys) add("PYRO.Quantidade", sys.quantidade);
    if ("peso" in sys) {
      add("PYRO.Peso", sys.municao ? `${sys.peso} (${loc("PYRO.Item.PesoLote")})` : sys.peso);
    }
    if ("custo" in sys) add("PYRO.Item.Custo", sys.custo);
    if ("equipado" in sys) {
      add("PYRO.Item.Equipado", loc(sys.equipado ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "arma") {
      add("PYRO.Item.Maos", sys.maos);
      add("PYRO.Item.UsaMunicao", loc(sys.usaMunicao ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "habilidade") {
      add("PYRO.Item.CustoXp", sys.ehBase ? loc("PYRO.Item.BaseTag") : sys.custoXp);
      add("PYRO.Uso.Nivel", `${sys.nivel} / ${sys.nivelMax}`);
    }
    if (this.item.type === "tecnica") {
      add("PYRO.Tecnica.Pontos", `${sys.pontos.gastos} / ${sys.pontos.disponiveis}`);
      add("PYRO.Uso.Nivel", `${sys.progresso.nivel} / ${sys.progresso.nivelMax}`);
    }
    if (this.item.type === "caminho") {
      add("PYRO.Item.Xp", `${sys.xpDisponivel} / ${sys.xp}`);
      add("PYRO.Item.XpGasta", sys.xpGasta);
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

    if (this.item.type === "pericia" && sys.atributos && !Array.isArray(sys.atributos)) {
      // Checkboxes chegam como { chave: true/false }.
      sys.atributos = Object.entries(sys.atributos).filter(([, v]) => v).map(([k]) => k);
    }

    if (this.item.type === "caminho" && sys.recursosConfig && !Array.isArray(sys.recursosConfig)) {
      /*
       * Os campos vêm indexados pela chave do recurso; o schema guarda lista.
       * O que já estava gravado e não apareceu na tela — recurso que o mestre
       * tirou do mundo, ou o select de habilidade que não existe fora de uma
       * ficha — é mantido, senão salvar qualquer outro campo apagaria isso.
       */
      const gravado = new Map(
        (this.item.system.recursosConfig ?? []).map(r => [r.chave, r]));
      for (const [chave, r] of Object.entries(sys.recursosConfig)) {
        gravado.set(chave, { ...gravado.get(chave), chave, ...r });
      }
      sys.recursosConfig = [...gravado.values()].map(r => ({
        chave: r.chave,
        formula: r.formula ?? "",
        habilidadeId: r.habilidadeId ?? ""
      }));
    }

    if (this.item.type === "caminho" && sys.afinidades && !Array.isArray(sys.afinidades)) {
      sys.afinidades = Object.values(sys.afinidades).map(a => ({
        tipo: a.tipo ?? "fogo",
        outro: a.outro ?? ""
      }));
    }

    if (this.item.type === "tecnica") {
      if (sys.tracos && !Array.isArray(sys.tracos)) {
        sys.tracos = Object.values(sys.tracos)
          .map(t => ({ chave: t.chave ?? "", grau: Math.max(1, Number(t.grau) || 1) }))
          .filter(t => t.chave);
      }
      // Checkboxes chegam como { chave: true/false }.
      if (sys.onus && !Array.isArray(sys.onus)) {
        sys.onus = Object.entries(sys.onus).filter(([, v]) => v).map(([k]) => k);
      }
      /*
       * As variações chegam indexadas pelo id da postura, e não por posição:
       * a lista da ficha é montada das posturas do ator, então a ordem dela
       * muda quando o personagem aprende outra. Só as escritas são guardadas.
       */
      if (sys.variacoes && !Array.isArray(sys.variacoes)) {
        sys.variacoes = Object.entries(sys.variacoes)
          .map(([posturaId, texto]) => ({ posturaId, texto: String(texto ?? "") }))
          .filter(v => v.texto.trim());
      }
      // A condição imposta pertence à especificidade escolhida: trocar de
      // especificidade sem limpar deixaria um "cortante" preso num filtro de
      // alcance, que nenhum ataque atenderia.
      if (sys.especificidade && sys.especificidade !== this.item.system.especificidade) {
        // O filtro nasce na primeira opção da condição nova, e não vazio: uma
        // técnica de "armas médias" com filtro em branco não aceitaria arma
        // nenhuma, e o select mostraria uma opção que não é a gravada.
        sys.filtro = Object.keys(opcoesDoFiltro(sys.especificidade) ?? {})[0] ?? "";
        sys.ataque = { id: "", nome: "" };
      }
      if (sys.ataque?.id && this.item.actor) {
        const escolhido = ataquesDoAtor(this.item.actor).find(a => a.id === sys.ataque.id);
        sys.ataque = { id: sys.ataque.id, nome: escolhido?.nome ?? "" };
      }
    }

    if (this.item.type === "runa" && sys.scalings && !Array.isArray(sys.scalings)) {
      const atuais = this.item.system.toObject().scalings;
      sys.scalings = Object.values(sys.scalings)
        .map((sc, i) => ({ ...(atuais[i] ?? {}), ...sc }));
    }

    if (this.item.type === "magia" && sys.runas && !Array.isArray(sys.runas)) {
      const atuais = this.item.system.toObject().runas;
      const runasForm = sys.runas;
      sys.runas = atuais.map((base, i) => {
        const r = runasForm[i] ?? {};
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
    const { tipoRuna, subtipo } = this.item.system;
    await this.item.update({ "system.scalings": scalingsPadrao(tipoRuna, subtipo) });
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

  static async #adicionarTraco() {
    const sys = this.item.system;
    const arr = sys.toObject().tracos;
    const usados = new Set(arr.map(t => t.chave));
    const livre = tracosCompativeis(sys.acaoBase).find(c => !usados.has(c.chave));
    if (!livre) return;
    arr.push({ chave: livre.chave, grau: 1 });
    await this.item.update({ "system.tracos": arr });
  }

  static async #removerTraco(event, target) {
    const arr = this.item.system.toObject().tracos;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.tracos": arr });
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
