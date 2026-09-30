<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class DisableMe
{
    public function afterSave($subject, $result)
    {
        return $result;
    }

    public function afterRun($subject, $result)
    {
        return $result;
    }
}
