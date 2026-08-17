import { PYRO } from "../config.mjs";
import { poolDoAtributo, formulaPool } from "../dados.mjs";

const fields = foundry.data.fields;

const num = (initial, opts = {}) =>
  new fields.NumberField({ required: true, integer: true, initial, ...opts });

/** Igual ao num, mas aceita fração (multiplicadores de efeito). */
const dec = (initial, opts = {}) =>
  new fields.NumberField({ required: true, initial, ...opts });

/**
 * Recurso com value/max nos nomes que o Foundry entende, pra virar barra de
 * token. O max é recalculado em prepareDerivedData a cada preparação; o campo
 * existe no schema só pra aparecer na lista de atributos rastreáveis.
 */
const recurso = (initial) => new fields.SchemaField({
  value: num(initial, { min: 0 }),
  max: num(initial, { min: 0 }),
  // Ajuste manual do máximo (itens mágicos, bênçãos, etc).
  bonus: num(0)
});

/** "+3" ou "-2": o sinal deixa claro de que lado o bônus puxa. */
const comSinal = n => (n > 0 ? `+${n}` : String(n));

/** Aceita a chave interna ("grande") ou o rótulo traduzido ("Grande"). */
function chaveTamanho(valor) {
  if (!valor) return null;
  const limpo = String(valor).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (limpo in PYRO.tamanhos) return limpo;
  for (const [chave, cfg] of Object.entries(PYRO.tamanhos)) {
    const rotulo = game.i18n.localize(cfg.label)
      .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (rotulo === limpo) return chave;
  }
  return null;
}

/**
 * Rótulo da aba de um caminho com recurso próprio: usa a variação (raciais)
 * ou o nome da profissão/classe, nunca o nome completo do caminho.
 */
function rotuloDoCaminho(caminho) {
  const s = caminho.system;
  const base = (s.ehRacial ? s.racaDetalhe : s.nomeCaminho)?.trim();
  return base
    ? game.i18n.format("PYRO.CaminhoNome", { nome: base })
    : caminho.name;
}

/* -------------------------------------------------------------------------- */
/*  Criatura: base compartilhada por personagem e NPC                          */
/* -------------------------------------------------------------------------- */

export class CriaturaData extends foundry.abstract.TypeDataModel {
  /** Fichas antigas guardavam o valor atual em "valor". */
  static migrateData(source) {
    for (const rec of Object.values(source.recursos ?? {})) {
      if (rec && rec.valor !== undefined && rec.value === undefined) {
        rec.value = rec.valor;
        delete rec.valor;
      }
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    const atributos = {};
    for (const chave of Object.keys(PYRO.atributos)) {
      atributos[chave] = new fields.SchemaField({
        valor: num(8, { min: 1 }),
        /*
         * Alvo dos efeitos, e não o valor digitado. Assim uma bênção ou uma
         * condição aparece como +X ao lado da base, do mesmo jeito que o
         * aumento de tier das habilidades, em vez de reescrever o número que
         * o jogador escolheu na criação.
         */
        bonus: num(0)
      });
    }

    return {
      det: num(1, { min: 1 }),
      tamanho: new fields.StringField({
        required: true, initial: "medio", choices: Object.keys(PYRO.tamanhos)
      }),
      // Passos de tamanho na tabela de categorias: +1 sobe uma categoria,
      // -1 desce. É por aqui que efeitos de aumentar/reduzir devem agir.
      tamanhoMod: num(0),
      // Quantas mãos a criatura tem para gestos e armas. Efeitos somam ou
      // tiram (membro extra, braço imobilizado).
      maos: num(2, { min: 0 }),

      /*
       * Deslocamento: a base sai de AGI/2 em prepareDerivedData, que roda
       * depois dos efeitos — por isso o alvo dos efeitos são estes dois
       * campos, e não a velocidade final. Bônus soma metros (Pressa +3),
       * multiplicador escala (Friagem 0.5, Lentidão 0).
       */
      velocidadeBonus: num(0),
      velocidadeMult: dec(1, { min: 0 }),

      atributos: new fields.SchemaField(atributos),

      recursos: new fields.SchemaField({
        pv: recurso(56),        // VIG 8 x 7
        estamina: recurso(100), // (8/2) x 25
        mana: recurso(40),      // SAB 8 x 5
        energia: recurso(40),   // PRE 8 x 5
        vontade: recurso(5),    // DET 1 x 5
        // Recursos personalizados definidos nas configurações do mundo.
        ...Object.fromEntries(
          Object.keys(PYRO.recursosCustom ?? {}).map(chave => [chave, recurso(0)])
        )
      }),

      // Valores base do personagem; equipamentos equipados somam por cima.
      defesas: new fields.SchemaField({
        categorias: new fields.SchemaField({
          fisico: num(1), energetico: num(1), mental: num(1)
        }),
        tipos: new fields.SchemaField(
          Object.keys(PYRO.tiposDano).reduce((acc, t) => {
            acc[t] = num(0);
            return acc;
          }, {})
        )
      }),

      dinheiro: num(0, { min: 0 }),
      biografia: new fields.HTMLField(),
      // Campos de mesa: dois fixos e dois de título livre.
      pessoas: new fields.HTMLField(),
      anotacoes: new fields.HTMLField(),
      livre1: new fields.SchemaField({
        titulo: new fields.StringField({ required: true, initial: "" }),
        texto: new fields.HTMLField()
      }),
      livre2: new fields.SchemaField({
        titulo: new fields.StringField({ required: true, initial: "" }),
        texto: new fields.HTMLField()
      })
    };
  }

  /* ---------------------------------------------------------------------- */

  prepareDerivedData() {
    const det = this.det;

    // Multiplicador de patamar: +10% por DET acima de 1.
    this.multi = 1 + 0.1 * (det - 1);

    /* --- Aumentos vindos das habilidades de tier 2+ (SRD §3) ------------- */
    const bonusHab = {};
    for (const item of this.parent.items) {
      if (item.type !== "habilidade") continue;
      for (const a of item.system.aumentos ?? []) {
        if (!a.atributo || !a.pontos) continue;
        bonusHab[a.atributo] = (bonusHab[a.atributo] ?? 0) + a.pontos;
      }
    }

    /* --- Atributos: limite por DET e valor efetivo (SRD Atributos) ------- */
    for (const [chave, attr] of Object.entries(this.atributos)) {
      // O total é o que vale em jogo: base digitada, mais os aumentos de tier
      // das habilidades, mais o que os efeitos somaram em .bonus.
      attr.bonusHab = bonusHab[chave] ?? 0;
      attr.bonusEfeito = attr.bonus ?? 0;
      attr.bonusTotal = attr.bonusHab + attr.bonusEfeito;
      // Piso 1: um efeito negativo forte não derruba o atributo abaixo da
      // primeira linha da Tabela de Dados.
      attr.total = Math.max(1, attr.valor + attr.bonusTotal);
      attr.bonusTexto = comSinal(attr.bonusTotal);
      attr.bonusNegativo = attr.bonusTotal < 0;
      attr.bonusDica = [
        game.i18n.format("PYRO.BonusOrigem.base", { valor: attr.valor }),
        attr.bonusHab ? game.i18n.format("PYRO.BonusOrigem.habilidades", { valor: comSinal(attr.bonusHab) }) : null,
        attr.bonusEfeito ? game.i18n.format("PYRO.BonusOrigem.efeitos", { valor: comSinal(attr.bonusEfeito) }) : null
      ].filter(Boolean).join(" · ");
      attr.limite = 15 * det;
      attr.efetivo = attr.total <= attr.limite
        ? attr.total
        : attr.limite + Math.floor((attr.total - attr.limite) / 2);
      attr.acimaDoLimite = attr.total > attr.limite;
      attr.pool = formulaPool(attr.efetivo);
      attr.poolCheia = formulaPool(attr.total); // usada em "Passar seus Limites"
    }

    const a = this.atributos;
    const arred = v => Math.floor(v);

    /* --- Recursos --------------------------------------------------------- */
    const r = this.recursos;
    r.pv.max = arred(a.vig.efetivo * 7 * this.multi) + r.pv.bonus;
    r.estamina.max = arred((a.vig.efetivo / 2) * 25 * this.multi) + r.estamina.bonus;
    r.mana.max = arred(a.sab.efetivo * 5 * this.multi) + r.mana.bonus;
    r.mana.recuperacao = Math.ceil(a.int.efetivo * this.multi);
    // Energia (feitiçaria): mesma conta da mana, com PRE no lugar de SAB.
    // AJUSTE: recuperação por cena também usa INT até o SRD definir.
    r.energia.max = arred(a.pre.efetivo * 5 * this.multi) + r.energia.bonus;
    r.energia.recuperacao = Math.ceil(a.int.efetivo * this.multi);
    r.vontade.max = det * 5 + r.vontade.bonus;

    // Recursos personalizados: (base + atributo x porPonto) +10% por patamar.
    for (const [chave, cfg] of Object.entries(PYRO.recursosCustom ?? {})) {
      const rec = r[chave];
      if (!rec) continue;
      const attr = a[cfg.atributo]?.efetivo ?? 0;
      rec.max = arred((cfg.base + attr * cfg.porPonto) * this.multi) + rec.bonus;
      const attrRec = a[cfg.recAtributo]?.efetivo;
      rec.recuperacao = attrRec ? Math.ceil(attrRec * (cfg.recPorPonto ?? 0) * this.multi) : 0;
    }

    /* --- Caminhos: raça, magia, feitiçaria, afinidades -------------------- */
    const caminhos = this.parent.items
      .filter(i => i.type === "caminho")
      .sort((x, y) => (x.sort - y.sort) || x.id.localeCompare(y.id));
    // O racial "primeiro" é o criado primeiro, não o primeiro da lista:
    // adicionar outra raça depois não rouba a definição de tamanho (itens
    // novos nascem com sort 0 e furavam a fila).
    const raciais = caminhos.filter(i => i.system.ehRacial)
      .sort((x, y) => (x._stats?.createdTime ?? 0) - (y._stats?.createdTime ?? 0));
    const racial = raciais[0];
    this.raca = racial?.system.raca ?? "humano";
    this.primeiroRacialId = racial?.id ?? null;
    /* --- Tamanho: raça, override de efeito e passos ----------------------- */
    // Efeitos rodam antes daqui, então comparo com o valor salvo: se mudou,
    // foi um efeito sobrepondo o tamanho e ele tem prioridade sobre a raça.
    const sobreposto = this.tamanho !== this._source.tamanho
      ? chaveTamanho(this.tamanho) : null;
    const base = sobreposto ?? racial?.system.tamanho ?? this._source.tamanho;
    const ordem = Object.keys(PYRO.tamanhos);
    let i = ordem.indexOf(base);
    if (i < 0) i = ordem.indexOf("medio");
    this.tamanho = ordem[Math.clamp(i + (this.tamanhoMod ?? 0), 0, ordem.length - 1)];

    const magicos = caminhos.filter(i => i.system.usaMagia);
    const feiticeiros = caminhos.filter(i => i.system.usaFeiticaria);

    // Abas condicionais, com fallback pra itens já existentes na ficha.
    this.temMagia = magicos.length > 0
      || this.parent.items.some(i => ["runa", "magia"].includes(i.type));
    this.temFeiticos = feiticeiros.length > 0
      || this.parent.items.some(i => i.type === "feitico");
    this.temTecnicas = this.parent.items.some(i =>
      i.type === "habilidade" && i.system.ehTecnica
    );

    // Fator mágico: média dos potenciais de todos os caminhos que usam magia.
    // Meio-dragão (4) + meio-elfo (2) = 3; humano mago (1) + elfo mago (2) = 1,5.
    const fatores = magicos
      .map(c => PYRO.linguas[c.system.potencial]?.fator)
      .filter(f => typeof f === "number");
    this.fatorLinguistico = fatores.length
      ? fatores.reduce((t, f) => t + f, 0) / fatores.length
      : (PYRO.linguas[racial?.system.potencial]?.fator ?? 1);
    this.potenciais = magicos.map(c => c.system.potencial);
    // AJUSTE: a língua "nativa" (a que não recebe destaque visual) é a do
    // primeiro caminho mágico da lista.
    this.linguaNativa = magicos[0]?.system.potencial
      ?? racial?.system.potencial ?? "humana";

    // Afinidades: união das listas de todos os caminhos mágicos. A lista
    // guarda também o elemento que dá a cor do rótulo na ficha (o primeiro
    // do grupo: Água/Gelo usa a cor de água).
    const els = new Set();
    const rotulos = [];
    const listaAfinidades = [];
    for (const c of magicos) {
      for (const af of c.system.afinidades ?? []) {
        const cfg = PYRO.afinidades[af.tipo];
        if (af.tipo === "outro") {
          if (af.outro && !rotulos.includes(af.outro)) {
            rotulos.push(af.outro);
            listaAfinidades.push({ label: af.outro, cor: null });
          }
          continue;
        }
        if (!cfg) continue;
        cfg.elementos.forEach(e => els.add(e));
        if (!rotulos.includes(cfg.label)) {
          rotulos.push(cfg.label);
          listaAfinidades.push({ label: cfg.label, cor: cfg.elementos[0] ?? null });
        }
      }
    }
    this.afinidadesLista = listaAfinidades;
    // Recursos concedidos pelos caminhos (aparecem na ficha e no token).
    const concedidos = new Set();
    for (const c of caminhos) {
      for (const chave of c.system.recursos ?? []) {
        if (PYRO.recursosCustom?.[chave]) concedidos.add(chave);
      }
    }
    this.recursosConcedidos = [...concedidos];

    // Caminhos com recurso próprio ganham uma aba dedicada às habilidades deles.
    const comRecurso = caminhos.filter(c =>
      (c.system.recursos ?? []).some(r => PYRO.recursosCustom?.[r])
    );
    this.caminhosProprios = comRecurso.map(c => c.id);
    this.temAbaCaminho = comRecurso.length > 0;
    this.abaCaminhoLabel = comRecurso.length === 1
      ? rotuloDoCaminho(comRecurso[0])
      : game.i18n.localize("PYRO.Tabs.caminhoProprio");

    this.afinidadesElementos = [...els];
    this.afinidadesTexto = rotulos.join(", ");
    this.semAfinidade = this.temMagia && magicos.length > 0 && !rotulos.length;

    /* --- Magia ------------------------------------------------------------ */
    this.sobrecargaLimite = det * 2; // Intenção segura base (por runa)

    /* --- Deslocamento e carga --------------------------------------------- */
    // Metros por ação de Mover, sem meio metro. Bônus entra antes do
    // multiplicador, então "+3m" e "metade" resultam em (base + 3) / 2.
    this.velocidadeBase = Math.floor(a.agi.efetivo / 2);
    this.velocidade = Math.max(0, Math.floor(
      (this.velocidadeBase + (this.velocidadeBonus ?? 0)) * (this.velocidadeMult ?? 1)
    ));
    const multCarga = PYRO.tamanhos[this.tamanho]?.multCarga ?? 2;
    this.carga = { max: a.for.efetivo * multCarga, atual: 0 };

    /* --- Soma de itens carregados/equipados ------------------------------- */
    const equipBonus = { fisico: 0, energetico: 0, mental: 0 };
    const equipTipos = Object.keys(PYRO.tiposDano).reduce((acc, t) => {
      acc[t] = 0;
      return acc;
    }, {});
    let bloqueioExtra = [];
    let esquivaExtra = [];

    let cargaExtra = 0;

    for (const item of this.parent.items) {
      const s = item.system;
      if (["arma", "equipamento", "consumivel"].includes(item.type)) {
        /*
         * Munição pesa 1 no total, quantas quer que sejam: uma aljava é uma
         * aljava. O peso do item é ignorado de propósito, é regra do sistema.
         */
        this.carga.atual += s.municao
          ? ((s.quantidade ?? 0) > 0 ? 1 : 0)
          : (s.peso ?? 0) * (s.quantidade ?? 1);
      }
      // Mochila equipada aumenta o quanto o personagem aguenta carregar.
      if (item.type === "equipamento" && s.equipado && s.categoria === "mochila") {
        cargaExtra += s.cargaBonus ?? 0;
      }
      if (item.type === "equipamento" && s.equipado) {
        for (const cat of Object.keys(equipBonus)) {
          equipBonus[cat] += s.defesas?.categorias?.[cat] ?? 0;
        }
        for (const tipo of Object.keys(equipTipos)) {
          equipTipos[tipo] += s.defesas?.tipos?.[tipo] ?? 0;
        }
        if (s.bloqueio) bloqueioExtra.push(s.bloqueio);
        if (s.esquiva) esquivaExtra.push(s.esquiva);
      }
    }

    // As mochilas entram depois do laço porque só ali se sabe quais estão
    // equipadas; o limite é sempre o da criatura mais o que ela veste.
    this.carga.bonus = cargaExtra;
    this.carga.max += cargaExtra;
    this.sobrepeso = this.carga.atual > this.carga.max;

    /* --- Defesas totais: base + equipamento ------------------------------- */
    const d = this.defesas;
    d.categoriasTotais = {};
    for (const cat of Object.keys(d.categorias)) {
      d.categoriasTotais[cat] = d.categorias[cat] + equipBonus[cat];
    }
    // Total por tipo = categoria correspondente + defesa do tipo + equipamento (SRD §6).
    d.totais = {};
    for (const [tipo, cfg] of Object.entries(PYRO.tiposDano)) {
      d.totais[tipo] = d.categoriasTotais[cfg.categoria] + d.tipos[tipo] + equipTipos[tipo];
    }

    /* --- Fórmulas de reação ------------------------------------------------ */
    this.bloqueio = ["2d4", ...bloqueioExtra].join(" + ");
    this.esquiva = ["2d12", ...esquivaExtra].join(" + ");
  }
}

/* -------------------------------------------------------------------------- */

export class PersonagemData extends CriaturaData {}

/**
 * NPC segue exatamente as mesmas regras do personagem: mana, energia e
 * recursos próprios só aparecem quando há um caminho que os conceda.
 */
export class NpcData extends CriaturaData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Anotações rápidas de mestre (táticas, gatilhos, tesouro).
      notas: new fields.HTMLField()
    };
  }

}
