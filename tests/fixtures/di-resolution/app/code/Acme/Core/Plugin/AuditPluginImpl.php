<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class AuditPluginImpl implements \Acme\Core\Api\AuditPluginInterface
{
    public function afterSave($subject, $result)
    {
        return $result;
    }
}
