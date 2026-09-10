/**
 * Data models dos atores (criatura, personagem, NPC): schema e valores
 * derivados — atributos em jogo, recursos, tamanho, carga, defesas e reações.
 */
import { PYRO } from "../config.mjs";
import { formulaPool, juntarDados, calcularFormula } from "../dados.mjs";
import { rotuloCurtoDoCaminho, configDoRecurso, nivelDoRecurso } from "./item-data.mjs";
import { num, dec } from "./campos.mjs";

const fields = foundry.data.fields;

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
  const limpo = PYRO.normalizarTexto(valor);
  if (limpo in PYRO.tamanhos) return limpo;
  for (const [chave, cfg] of Object.entries(PYRO.tamanhos)) {
    if (PYRO.normalizarTexto(game.i18n.localize(cfg.label)) === limpo) return chave;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Criatura: base compartilhada por personagem e NPC                          */
/* -------------------------------------------------------------------------- */

export class CriaturaData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const atributos = {};
    for (const chave of Object.keys(PYRO.atributos)) {
      atributos[chave] = new fields.SchemaField({
        valor: num(8, { min: 1 }),
        /*
         * Alvo dos efeitos, e não o valor digitado. Assim uma bênção ou uma
         * condição aparece como +X ao lado da base, do mesmo jeito que o
         * aumento de ranque das habilidades, em vez de reescrever o número que
         * o jogador escolheu na criação.
         */
        bonus: num(0)
      });
    }

    return {
      /*
       * Determinação (SRD Atributos). Aceita 0 porque a regra opcional do
       * prólogo começa aí; tudo que a DET governa já cai sozinho no lugar
       * nessa ponta — o multiplicador de recursos vira 0,9, a Força de
       * Vontade máxima vira 0 e a Intenção e o Esforço seguros também.
       */
      det: num(1, { min: 0 }),
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

      /*
       * Voar e nadar não têm base derivada de atributo: ou a criatura tem, ou
       * não tem. Zero é o normal, e é por isso que a ficha só mostra estes
       * dois quando são diferentes de zero — asas e guelras são exceção, não
       * uma linha vazia na ficha de todo mundo.
       */
      deslocamentoAereo: num(0, { min: 0 }),
      deslocamentoNatacao: num(0, { min: 0 }),

      /*
       * Dados a mais nas reações, em dados inteiros: +2 no bloqueio é "mais
       * dois d4". As faces são fixas pelo sistema (d4 bloqueia, d12 esquiva),
       * então o efeito só precisa dizer quantos. Mesmo motivo da velocidade:
       * a fórmula final é derivada, e efeito não alcança campo derivado.
       */
      bloqueioBonus: num(0),
      esquivaBonus: num(0),

      /*
       * Degraus somados na escada das línguas (humana → élfica → ...). É o
       * alvo do efeito "potencial mágico": um Milagre grava +1 aqui e o
       * humano passa a conjurar como um elfo — fator de mana, multiplicador
       * de efeito e língua nativa sobem juntos, sem trocar a raça.
       */
      potencialBonus: num(0),

      atributos: new fields.SchemaField(atributos),

      recursos: new fields.SchemaField({
        pv: recurso(56),        // VIG 8 x 7
        estamina: recurso(80),  // VIG 8 x 10
        mana: recurso(40),      // SAB 8 x 5
        energia: recurso(40),   // PRE 8 x 5
        // Todo personagem começa a jornada com 0 pontos (SRD Atributos): o
        // máximo é DET x 5, mas eles são conquistados em jogo, não dados.
        vontade: recurso(0),
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

      /*
       * Crenças e instintos (SRD §11): três de cada, em campos fixos. São
       * traços de interpretação, e é deles que saem os pontos de Força de
       * Vontade — por isso moram na ficha, e não numa anotação solta.
       */
      crencas: new fields.ArrayField(new fields.StringField({ required: true, initial: "" }),
        { initial: ["", "", ""] }),
      instintos: new fields.ArrayField(new fields.StringField({ required: true, initial: "" }),
        { initial: ["", "", ""] }),

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

    // Multiplicador de patamar: +10% por DET acima de 1, e −10% na DET 0.
    this.multi = 1 + 0.1 * (det - 1);

    /* --- Atributos: base mais o que os efeitos somaram ------------------- */
    for (const [chave, attr] of Object.entries(this.atributos)) {
      attr.bonusTotal = attr.bonus ?? 0;
      // Piso 1: um efeito negativo forte não derruba o atributo abaixo da
      // primeira linha da Tabela de Dados.
      attr.total = Math.max(1, attr.valor + attr.bonusTotal);
      attr.bonusTexto = comSinal(attr.bonusTotal);
      attr.bonusNegativo = attr.bonusTotal < 0;
      attr.bonusDica = [
        game.i18n.format("PYRO.BonusOrigem.base", { valor: attr.valor }),
        attr.bonusTotal ? game.i18n.format("PYRO.BonusOrigem.efeitos", { valor: comSinal(attr.bonusTotal) }) : null
      ].filter(Boolean).join(" · ");

      /*
       * A ficha em repouso mostra um número por atributo: o que vale em jogo.
       * O hover troca esse número pela conta que chegou nele, "14 +1", e o
       * clique cai no campo, que continua editando só a base. Sem bônus não
       * há conta a mostrar, e a célula não troca nada no hover.
       */
      attr.totalTexto = String(attr.total);
      attr.mostrarDetalhe = attr.bonusTotal !== 0;
      attr.detalheTexto = `${attr.valor} ${comSinal(attr.bonusTotal)}`;
      attr.classeTotal = attr.bonusNegativo ? "negativo" : attr.bonusTotal > 0 ? "somado" : "";
      attr.dicaTotal = attr.bonusDica;

      attr.pool = formulaPool(attr.total);
    }

    const atributos = this.atributos;

    /* --- Caminhos e tamanho ----------------------------------------------- */
    /*
     * O tamanho é resolvido antes dos recursos porque o PV por VIG sai dele:
     * um Enorme tem 14 por VIG onde um Médio tem 7.
     */
    const caminhos = this.parent.items
      .filter(i => i.type === "caminho")
      .sort((x, y) => (x.sort - y.sort) || x.id.localeCompare(y.id));
    // O racial "primeiro" é o criado primeiro, não o primeiro da lista:
    // itens novos nascem com sort 0 e furariam a fila, e adicionar outra raça
    // depois não pode roubar a definição de tamanho.
    const raciais = caminhos.filter(i => i.system.ehRacial)
      .sort((x, y) => (x._stats?.createdTime ?? 0) - (y._stats?.createdTime ?? 0));
    const racial = raciais[0];
    this.raca = racial?.system.raca ?? "humano";
    this.primeiroRacialId = racial?.id ?? null;

    // Efeitos rodam antes daqui, então comparo com o valor salvo: se mudou,
    // foi um efeito sobrepondo o tamanho e ele tem prioridade sobre a raça.
    const sobreposto = this.tamanho !== this._source.tamanho
      ? chaveTamanho(this.tamanho) : null;
    const base = sobreposto ?? racial?.system.tamanho ?? this._source.tamanho;
    const ordem = Object.keys(PYRO.tamanhos);
    let i = ordem.indexOf(base);
    if (i < 0) i = ordem.indexOf("medio");
    this.tamanho = ordem[Math.clamp(i + (this.tamanhoMod ?? 0), 0, ordem.length - 1)];

    /*
     * Número exato de espaços do massivo e do colossal. Só vale enquanto o
     * tamanho continua sendo o que a raça declarou: um efeito que empurra a
     * criatura para outro degrau descarta o número, porque ele descrevia o
     * degrau antigo.
     */
    this.tamanhoExato = (this.tamanho === racial?.system.tamanho)
      ? PYRO.tamanhoExatoNaFaixa(this.tamanho, racial?.system.tamanhoExato)
      : 0;
    this.escalaTamanho = PYRO.escalaTamanho(this.tamanho, this.tamanhoExato);
    this.alcanceTamanho = PYRO.alcanceTamanho(this.tamanho, this.tamanhoExato);
    this.miraLivre = PYRO.miraLivre(this.tamanho, this.tamanhoExato);

    /* --- Recursos --------------------------------------------------------- */
    const recursos = this.recursos;
    const vidaPorVig = PYRO.tamanhos[this.tamanho]?.vidaPorVig ?? 7;
    recursos.pv.max = Math.floor(atributos.vig.total * vidaPorVig * this.multi)
      + recursos.pv.bonus;
    recursos.estamina.max = Math.floor(atributos.vig.total * 10 * this.multi)
      + recursos.estamina.bonus;
    recursos.mana.max = Math.floor(atributos.sab.total * 5 * this.multi)
      + recursos.mana.bonus;
    /*
     * A recuperação é metade do atributo, e só. O multiplicador de patamar
     * mexe no que cabe no tanque, não no ritmo com que ele enche — a regra
     * antiga aplicava os 10% aqui também e fazia a recuperação pular a cada
     * ponto de Determinação.
     */
    const recuperacao = Math.floor(atributos.int.total / 2);
    recursos.mana.recuperacao = recuperacao;
    recursos.energia.max = Math.floor(atributos.pre.total * 5 * this.multi)
      + recursos.energia.bonus;
    recursos.energia.recuperacao = recuperacao;
    recursos.vontade.max = det * 5 + recursos.vontade.bonus;

    /*
     * Ensanguentado abaixo da metade da vida, Machucado abaixo de um quarto
     * (SRD Atributos). Por si não fazem nada — são o gancho de que habilidades
     * e a Vontade de Viver precisam, e o que a ficha mostra de estado.
     *
     * O limiar arredonda para cima porque a regra é "menos que": com 30 de
     * vida máxima, Machucado começa abaixo de 8, e não abaixo de 7.
     */
    this.limiaresPv = {
      ensanguentado: Math.ceil(recursos.pv.max / 2),
      machucado: Math.ceil(recursos.pv.max / 4)
    };
    this.ensanguentado = recursos.pv.value > 0 && recursos.pv.value < this.limiaresPv.ensanguentado;
    this.machucado = recursos.pv.value > 0 && recursos.pv.value < this.limiaresPv.machucado;
    this.caido = recursos.pv.value <= 0;

    // A recuperação fica fora do multiplicador, como a da mana.
    /*
     * Recurso de raça: o máximo sai de uma fórmula, e quem manda nela é o
     * Caminho que concede o recurso — a configuração do mundo só dá o ponto de
     * partida. [NVL] na fórmula é o nível da habilidade apontada lá.
     */
    // Os mesmos dados de uma rolagem, para a fórmula do recurso enxergar o que
    // uma fórmula de habilidade enxerga — inclusive @dados.sab.
    const daFormula = this.parent.getRollData();

    for (const [chave, cfg] of Object.entries(PYRO.recursosCustom ?? {})) {
      const rec = recursos[chave];
      if (!rec) continue;
      const dono = caminhos.find(c => (c.system.recursos ?? []).includes(chave));
      const { formula } = configDoRecurso(dono, chave);
      const bruto = calcularFormula(formula, {
        ...daFormula, nvl: nivelDoRecurso(this.parent, dono, chave)
      });
      rec.max = Math.floor(bruto * this.multi) + rec.bonus;
      const attrRec = atributos[cfg.recAtributo]?.total;
      rec.recuperacao = attrRec
        ? Math.floor((attrRec * (cfg.recPorPonto ?? 0)) / 2) : 0;
    }

    /* --- Caminhos: magia, feitiçaria, afinidades -------------------------- */
    const magicos = caminhos.filter(i => i.system.usaMagia);
    const feiticeiros = caminhos.filter(i => i.system.usaFeiticaria);

    // Abas condicionais, com fallback pra itens já existentes na ficha.
    this.temMagia = magicos.length > 0
      || this.parent.items.some(i => ["runa", "magia"].includes(i.type));
    this.temFeiticos = feiticeiros.length > 0
      || this.parent.items.some(i => i.type === "feitico");
    this.temTecnicas = this.parent.items.some(i =>
      i.type === "tecnica" || (i.type === "habilidade" && i.system.ehPostura)
    );

    /*
     * Efeito de potencial (o Milagre) sobe cada caminho na escada das
     * línguas antes de qualquer conta: fator de mana, lista de potenciais e
     * língua nativa enxergam o degrau já subido.
     */
    const potencialDe = c => PYRO.subirPotencial(c.system.potencial, this.potencialBonus);

    // Fator mágico: média dos potenciais de todos os caminhos que usam magia.
    // Meio-dragão (4) + meio-elfo (2) = 3; humano mago (1) + elfo mago (2) = 1,5.
    const fatores = magicos
      .map(c => PYRO.linguas[potencialDe(c)]?.fator)
      .filter(f => typeof f === "number");
    this.fatorLinguistico = fatores.length
      ? fatores.reduce((t, f) => t + f, 0) / fatores.length
      : (PYRO.linguas[racial ? potencialDe(racial) : "humana"]?.fator ?? 1);
    this.potenciais = magicos.map(potencialDe);
    // A língua "nativa" (a que não recebe destaque visual) é a do primeiro
    // caminho mágico da lista.
    this.linguaNativa = magicos[0] ? potencialDe(magicos[0])
      : racial ? potencialDe(racial) : "humana";

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
      ? rotuloCurtoDoCaminho(comRecurso[0])
      : game.i18n.localize("PYRO.Tabs.caminhoProprio");

    this.afinidadesElementos = [...els];
    this.afinidadesTexto = rotulos.join(", ");
    this.semAfinidade = this.temMagia && magicos.length > 0 && !rotulos.length;

    /* --- Magia ------------------------------------------------------------ */
    this.sobrecargaLimite = det * 2; // Intenção segura base (por runa)

    /* --- Deslocamento e carga --------------------------------------------- */
    // Metros por ação de Mover, sem meio metro. Bônus entra antes do
    // multiplicador, então "+3m" e "metade" resultam em (base + 3) / 2.
    this.velocidadeBase = Math.floor(atributos.agi.total / 2);
    this.velocidade = Math.max(0, Math.floor(
      (this.velocidadeBase + (this.velocidadeBonus ?? 0)) * (this.velocidadeMult ?? 1)
    ));
    const multCarga = PYRO.tamanhos[this.tamanho]?.multCarga ?? 2;
    // Minúsculo carrega meia FOR, e meio quilo de capacidade não existe.
    this.carga = { max: Math.floor(atributos.for.total * multCarga), atual: 0 };

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
      const sys = item.system;
      if (["arma", "equipamento", "consumivel"].includes(item.type)) {
        // Munição pesa 1 no total, quantas quer que sejam: uma aljava é uma
        // aljava. O peso do item é ignorado de propósito (regra do sistema).
        this.carga.atual += sys.municao
          ? ((sys.quantidade ?? 0) > 0 ? 1 : 0)
          : (sys.peso ?? 0) * (sys.quantidade ?? 1);
      }
      // Mochila equipada aumenta o quanto o personagem aguenta carregar.
      if (item.type === "equipamento" && sys.equipado && sys.categoria === "mochila") {
        cargaExtra += sys.cargaBonus ?? 0;
      }
      if (item.type === "equipamento" && sys.equipado) {
        for (const cat of Object.keys(equipBonus)) {
          equipBonus[cat] += sys.defesas?.categorias?.[cat] ?? 0;
        }
        for (const tipo of Object.keys(equipTipos)) {
          equipTipos[tipo] += sys.defesas?.tipos?.[tipo] ?? 0;
        }
        if (sys.bloqueio) bloqueioExtra.push(sys.bloqueio);
        if (sys.esquiva) esquivaExtra.push(sys.esquiva);
      }
    }

    // As mochilas entram depois do laço porque só ali se sabe quais estão
    // equipadas; o limite é sempre o da criatura mais o que ela veste.
    this.carga.bonus = cargaExtra;
    this.carga.max += cargaExtra;
    this.sobrepeso = this.carga.atual > this.carga.max;

    /*
     * Voo e natação não passam pelo bônus e pelo multiplicador da velocidade
     * terrestre: uma Lentidão que corta o passo pela metade não corta o voo,
     * que é outro deslocamento. Quem quiser mexer neles mexe no campo.
     *
     * O voo é a única exceção: sobrepeso o desliga (SRD, Regras Gerais), e por
     * isso ele é lido depois da carga estar fechada.
     */
    this.voando = this.deslocamentoAereo > 0 && !this.sobrepeso;
    this.vooBloqueado = this.deslocamentoAereo > 0 && this.sobrepeso;
    this.temDeslocamentoExtra = this.deslocamentoAereo > 0 || this.deslocamentoNatacao > 0;

    /* --- Defesas totais: base + equipamento ------------------------------- */
    const defesas = this.defesas;
    defesas.categoriasTotais = {};
    for (const cat of Object.keys(defesas.categorias)) {
      defesas.categoriasTotais[cat] = defesas.categorias[cat] + equipBonus[cat];
    }
    // Total por tipo = categoria correspondente + defesa do tipo + equipamento (SRD §6).
    defesas.totais = {};
    for (const [tipo, cfg] of Object.entries(PYRO.tiposDano)) {
      defesas.totais[tipo] = defesas.categoriasTotais[cfg.categoria]
        + defesas.tipos[tipo] + equipTipos[tipo];
    }

    /* --- Fórmulas de reação ------------------------------------------------ */
    /*
     * Base do sistema mais o que o efeito somar, e o equipamento entra por
     * fora com a fórmula que estiver escrita nele. Bônus negativo tira dados
     * mas para em zero: rolar dado nenhum já é o pior caso.
     */
    const reacao = (cfg, bonus, extras) => juntarDados([
      `${Math.max(0, cfg.dados + (bonus ?? 0))}d${cfg.faces}`,
      ...extras
    ]);
    this.bloqueio = reacao(PYRO.reacoes.bloqueio, this.bloqueioBonus, bloqueioExtra);
    this.esquiva = reacao(PYRO.reacoes.esquiva, this.esquivaBonus, esquivaExtra);
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
