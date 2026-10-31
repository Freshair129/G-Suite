use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::fmt;

struct Strict(Value);
impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Strict;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("JSON with unique object keys") }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Strict,E> { Ok(Strict(Value::Bool(v))) }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Strict,E> { Ok(Strict(Value::Number(v.into()))) }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Strict,E> { Ok(Strict(Value::Number(v.into()))) }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Strict,E> { Number::from_f64(v).map(|n| Strict(Value::Number(n))).ok_or_else(|| E::custom("nonfinite JSON number")) }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Strict,E> { Ok(Strict(Value::String(v.into()))) }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Strict,E> { Ok(Strict(Value::String(v))) }
            fn visit_unit<E: de::Error>(self) -> Result<Strict,E> { Ok(Strict(Value::Null)) }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Strict,A::Error> {
                let mut values = Vec::new();
                while let Some(Strict(v)) = a.next_element()? { values.push(v); }
                Ok(Strict(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Strict,A::Error> {
                let mut values = Map::new();
                while let Some(k) = a.next_key::<String>()? {
                    if values.contains_key(&k) { return Err(de::Error::custom("duplicate JSON key")); }
                    let Strict(v) = a.next_value()?; values.insert(k,v);
                }
                Ok(Strict(Value::Object(values)))
            }
        }
        d.deserialize_any(V)
    }
}
pub(crate) fn parse(bytes: &[u8]) -> Result<Value,String> {
    serde_json::from_slice::<Strict>(bytes).map(|s| s.0).map_err(|e| e.to_string())
}
